"""Tidy Agent — calls the local Hermes agent via its OpenAI-compatible API with streaming."""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import AsyncGenerator
from dataclasses import dataclass
from enum import Enum, auto

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

# Hard cap on document text sent to the model.  Line-item catalogs can be long,
# so this is generous; truncating mid-table drops SKUs.  Tune down via env if a
# local model's context window is smaller.
MAX_DOCUMENT_CHARS = int(os.environ.get("MAX_DOCUMENT_CHARS", 40_000))

# Request timeout in seconds.  Local Ollama models should finish a typical
# invoice well within 120 s; raise via REQUEST_TIMEOUT env var if needed.
REQUEST_TIMEOUT = float(os.environ.get("REQUEST_TIMEOUT", 120))

# Maximum tokens the model may generate per request.  Large line-item tables
# need plenty of room or the JSON gets cut off mid-array.
MAX_TOKENS = int(os.environ.get("MAX_TOKENS", 8192))

SYSTEM_PROMPT = """You are Tidy, an intelligent document parser built by Doc Tidy.

Your task:
1. Carefully read the document text provided by the user.
2. Think step-by-step about the document's structure and content inside <thinking> tags.
3. After your thinking, produce a single valid JSON object that captures the document's key structured data.

Rules:
- Always open your response with <thinking> and close with </thinking> before writing any JSON.
- The JSON must appear after the closing </thinking> tag with no markdown fencing.
- The JSON should be well-structured and comprehensive — extract all meaningful fields.
- Do not include explanatory text outside the <thinking> block or the JSON object.

Vendor identification:
- Include a top-level "vendorName" field with the vendor/brand/supplier name exactly
  as printed on the document (used to look up vendor-specific rules downstream).

Line items (only when the document contains a product / order / invoice line-item table):
- Include a top-level "lineItems" array. Each element is one row, normalized to:
  {
    "styleNumber": "<style/product/item number>",
    "colorCode":   "<color code or name>",
    "size":        "<the single size for THIS row>",
    "width":       "<width if a width column/field exists, else null>",
    "qty":         <the actual ordered quantity for this row as a number>,
    "sku":         "<the full SKU for this row, in this vendor's format>"
  }
- Identify where sizes live. If one printed row spreads quantities across several
  size columns (a size-grid), EXPLODE it into one lineItems element per size that
  has a quantity, repeating styleNumber/colorCode and setting that size's qty.
- "qty" is the real ordered quantity for the row/size — NOT a pack size, case
  pack, prepack count, unit price, or line total. If unsure, prefer the units
  column over any pack/case column.
- Use null for "width" when the document has no width concept. Do NOT invent it.
- Build the full "sku" string for each line item yourself. SKU formats are
  vendor-specific and sometimes complex (varying components, order, separators,
  prefixes/initials, and value transformations — e.g. a size of "7 1/2" written as
  "7.5"). When REFERENCE CORRECTIONS for this vendor are provided below, reproduce
  that vendor's SKU format EXACTLY as shown — same components, order, separators,
  initial, and transformations. When no reference is available (a new vendor),
  assemble a reasonable SKU from the fields above as your best effort; the user will
  correct it once, and you must follow that corrected format for the vendor from
  then on.
- Preserve any other meaningful per-row fields (e.g. description, unitPrice) too.
"""

TABLE_SYSTEM_PROMPT = """You are Tidy's table formatter.

You are given a JSON object that was already extracted from a document. Reorganize
it into one or more tables suitable for display to a person.

Return a single valid JSON object with this exact shape and nothing else:
{
  "tables": [
    {
      "title": "<short section name>",
      "columns": ["<column header>", ...],
      "rows": [["<cell>", ...], ...]
    }
  ]
}

Rules:
- Group scalar key/value fields into a two-column table with columns ["Field", "Value"].
- Render arrays of similar objects as a proper table: one column per shared key, one row per item.
- You may emit multiple tables (e.g. a summary table plus a line-items table).
- Every row must have exactly as many cells as there are columns; pad with "" if needed.
- All cell values must be strings, numbers, booleans, or null — never nested objects or arrays.
- Output only the JSON object. No markdown fencing, no commentary, no <thinking> tags.
"""


class TokenType(Enum):
    THINKING = auto()
    OUTPUT = auto()


@dataclass
class StreamChunk:
    token_type: TokenType
    content: str


def _make_hermes_client() -> tuple[AsyncOpenAI, str]:
    """Build an AsyncOpenAI client pointed at the configured Hermes backend.

    Returns the client and the model name.  base_url is optional — omit it when
    pointing at the real OpenAI API.
    """
    base_url = os.environ.get("HERMES_BASE_URL") or None
    model = os.environ.get("HERMES_MODEL", "hermes3")
    api_key = os.environ.get("HERMES_API_KEY", "not-needed")

    client_kwargs: dict = {"api_key": api_key, "timeout": REQUEST_TIMEOUT}
    if base_url:
        client_kwargs["base_url"] = base_url

    return AsyncOpenAI(**client_kwargs), model


def _build_correction_rules(examples) -> str:
    """Collect the user's correction notes into explicit, top-level rules.

    Notes are the user's *instructions* ("Qty comes from the Units column, not
    the pack count"). Buried inside a prior user turn a local model ignores
    them, so we promote them into the system prompt as hard rules that apply to
    every document parsed in this request.
    """
    notes: list[str] = []
    for ex in examples or []:
        note = (getattr(ex, "note", None) or "").strip()
        if note:
            notes.append(note)
    # Dedupe while preserving order (a vendor may have repeated the same note).
    notes = list(dict.fromkeys(notes))
    if not notes:
        return ""
    rules = "\n".join(f"- {n}" for n in notes)
    return (
        "\n\nLEARNED CORRECTIONS — the user has previously corrected your output on "
        "similar documents and left these instructions. Treat each as a HARD RULE "
        "and apply it to the document below, even if it contradicts your default "
        "reading:\n" + rules
    )


def _build_vendor_format_anchor(sku_samples) -> str:
    """Promote a vendor's setup-time sample SKU(s) into a hard formatting rule.

    A registered vendor may carry one or more real ``skuSamples`` captured during
    setup (see design-log/2026-06-26-multiple-vendor-sku-samples.md). They are
    cold-start anchors — the model has a correct target on the very first run,
    before any correction exists. A vendor can use several SKU formats, so all
    samples are listed and the model matches whichever fits each row. Reference
    corrections (when present) still take precedence as the higher-fidelity,
    row-level signal; this only shapes the format.
    """
    if isinstance(sku_samples, str):
        sku_samples = [sku_samples]
    samples = [s.strip() for s in (sku_samples or []) if s and s.strip()]
    # Dedupe while preserving order.
    samples = list(dict.fromkeys(samples))
    if not samples:
        return ""

    if len(samples) == 1:
        examples_line = f"this vendor's SKUs follow the exact shape of this real example: {samples[0]}"
        match_clause = "build every row's \"sku\" in this same format"
    else:
        bullets = "\n".join(f"  - {s}" for s in samples)
        examples_line = (
            "this vendor uses more than one SKU format; its SKUs follow the exact "
            f"shape of these real examples:\n{bullets}"
        )
        match_clause = (
            "build every row's \"sku\" to match the format of whichever example fits "
            "that row"
        )

    return (
        f"\n\nVENDOR SKU FORMAT — {examples_line}\n"
        f"Treat it as a HARD RULE: {match_clause} — the same components, order, "
        "separators, prefix/initial, casing, and value transformations (e.g. a size "
        "of \"7 1/2\" written as \"7.5\") — substituting each row's own values. If "
        "reference corrections for this vendor are provided below, prefer those exact "
        "field choices where they conflict."
    )


def _build_example_messages(examples) -> list[dict]:
    """Render retrieved corrections as prior user/assistant turns.

    Each example becomes a user turn (the past document sample) followed by an
    assistant turn (the user-approved corrected JSON). The framing is explicit:
    the assistant turn is the *verified-correct* output the user signed off on,
    so the model reproduces those exact field choices on similar (often
    identical) documents instead of re-extracting from scratch.
    """
    messages: list[dict] = []
    for ex in examples or []:
        sample = (ex.document_text_sample or "").strip()
        if not sample:
            continue
        note_hint = (
            f"\n\nThe user's instruction with this correction: {ex.note}"
            if getattr(ex, "note", None)
            else ""
        )
        corrected = json.dumps(ex.corrected_output, ensure_ascii=False)
        messages.append(
            {
                "role": "user",
                "content": (
                    "REFERENCE CORRECTION — you parsed this document before and the user "
                    "reviewed and fixed your output. Study it as the authoritative answer; "
                    "if the next document is the same or similar, reproduce these exact "
                    f"field choices.{note_hint}\n\nDocument text:\n\n{sample}"
                ),
            }
        )
        messages.append(
            {
                "role": "assistant",
                "content": (
                    "<thinking>This is the user-approved correct extraction. I will mirror "
                    "these field choices and honor the user's instruction on similar "
                    f"documents.</thinking>\n{corrected}"
                ),
            }
        )
    return messages


async def stream_tidy(
    document_text: str,
    examples=None,
    vendor_sku_samples=None,
) -> AsyncGenerator[StreamChunk, None]:
    """
    Stream the Tidy agent's response for the given document text.

    Connects to the local Hermes server at HERMES_BASE_URL using the OpenAI-compatible
    chat completions API.  Yields StreamChunk objects labelled THINKING or OUTPUT.
    THINKING chunks come from inside <thinking>…</thinking>.
    OUTPUT chunks are the JSON content that follows.

    ``examples`` is an optional list of retrieved corrections (see
    ``corrections.retrieve_examples``); when present they are injected as prior
    turns so the model mimics the user's preferred extraction.

    ``vendor_sku_samples`` is an optional list of real SKUs captured at vendor
    setup; when present they're injected as a hard formatting rule so the model
    reproduces that vendor's SKU shape(s) from the first run (cold-start anchor).
    """
    client, model = _make_hermes_client()
    base_url = os.environ.get("HERMES_BASE_URL") or None

    if len(document_text) > MAX_DOCUMENT_CHARS:
        logger.warning(
            "Document text is %d chars — truncating to %d",
            len(document_text),
            MAX_DOCUMENT_CHARS,
        )
        document_text = document_text[:MAX_DOCUMENT_CHARS] + "\n\n[... truncated ...]"

    logger.info("Calling Hermes model '%s' at %s", model, base_url)

    buffer = ""
    in_thinking = False
    thinking_done = False

    system_content = (
        SYSTEM_PROMPT
        + _build_vendor_format_anchor(vendor_sku_samples)
        + _build_correction_rules(examples)
    )
    messages: list[dict] = [{"role": "system", "content": system_content}]
    messages.extend(_build_example_messages(examples))

    # When we injected reference corrections, remind the model—right before the
    # real document—to actually apply them. The instruction sticks better here
    # (closest to the task) than only in the system prompt.
    apply_hint = (
        "Apply the learned corrections and the field choices from the reference "
        "correction(s) above to this document.\n\n"
        if examples
        else ""
    )
    messages.append({"role": "user", "content": f"{apply_hint}Document text:\n\n{document_text}"})

    # temperature is not supported by OpenAI reasoning models (e.g. gpt-5.5).
    # Omit it universally — the system prompt guides determinism sufficiently.
    stream = await client.chat.completions.create(
        model=model,
        messages=messages,
        stream=True,
        max_tokens=MAX_TOKENS,
    )

    async for chunk in stream:
        # Some OpenAI-compatible backends emit chunks with no usable choice —
        # e.g. usage-only final frames, keep-alive frames, or partial frames
        # under load — where `choices` is None or empty (and occasionally the
        # `delta` itself is None).  Indexing those raised
        # `TypeError: 'NoneType' object is not subscriptable`, which surfaced
        # intermittently and cleared on retry.  Skip anything without a delta.
        if not chunk.choices:
            continue
        delta = chunk.choices[0].delta
        if delta is None:
            continue

        # Reasoning models (e.g. GPT-5.5, Hermes thinking) stream their
        # chain-of-thought in a dedicated `reasoning_content` (or `reasoning`)
        # field rather than inside <thinking> tags in `content`.  Surface it
        # directly as THINKING so the reasoning panel populates.
        reasoning = _extract_reasoning(delta)
        if reasoning:
            yield StreamChunk(TokenType.THINKING, reasoning)

        content = delta.content
        if content is None:
            continue

        buffer += content

        # Process buffer greedily
        while buffer:
            if not thinking_done:
                if not in_thinking:
                    # Look for <thinking> opening
                    tag_pos = buffer.find("<thinking>")
                    if tag_pos != -1:
                        pre = buffer[:tag_pos]
                        if pre:
                            # Text before <thinking> — treat as output (unlikely but safe)
                            yield StreamChunk(TokenType.OUTPUT, pre)
                        buffer = buffer[tag_pos + len("<thinking>"):]
                        in_thinking = True
                    else:
                        # Haven't found tag yet — hold partial if it could be a partial tag
                        if buffer.endswith("<") or buffer.endswith("<t") or \
                                buffer.endswith("<th") or buffer.endswith("<thi") or \
                                buffer.endswith("<thin") or buffer.endswith("<think") or \
                                buffer.endswith("<thinki") or buffer.endswith("<thinkin"):
                            break  # wait for more data
                        yield StreamChunk(TokenType.OUTPUT, buffer)
                        buffer = ""
                else:
                    # Inside <thinking> — look for </thinking>
                    close_pos = buffer.find("</thinking>")
                    if close_pos != -1:
                        thinking_chunk = buffer[:close_pos]
                        if thinking_chunk:
                            yield StreamChunk(TokenType.THINKING, thinking_chunk)
                        buffer = buffer[close_pos + len("</thinking>"):]
                        in_thinking = False
                        thinking_done = True
                    else:
                        # Check for partial closing tag at end
                        partial_match = _partial_close_suffix(buffer)
                        if partial_match:
                            safe = buffer[: len(buffer) - partial_match]
                            if safe:
                                yield StreamChunk(TokenType.THINKING, safe)
                            buffer = buffer[len(buffer) - partial_match :]
                            break
                        yield StreamChunk(TokenType.THINKING, buffer)
                        buffer = ""
            else:
                # All remaining content is JSON output
                yield StreamChunk(TokenType.OUTPUT, buffer)
                buffer = ""

    # Flush remaining buffer
    if buffer.strip():
        token_type = TokenType.THINKING if in_thinking else TokenType.OUTPUT
        yield StreamChunk(token_type, buffer)


def _extract_reasoning(delta) -> str | None:
    """
    Pull chain-of-thought text out of a streaming delta for reasoning models.

    OpenAI-compatible reasoning backends expose it as `reasoning_content`; some
    use `reasoning`.  Newer/older SDK versions may stash unknown fields in
    `model_extra` rather than as direct attributes, so check there too.
    """
    for attr in ("reasoning_content", "reasoning"):
        value = getattr(delta, attr, None)
        if value:
            return value

    extra = getattr(delta, "model_extra", None) or {}
    for key in ("reasoning_content", "reasoning"):
        value = extra.get(key)
        if value:
            return value

    return None


def _partial_close_suffix(text: str) -> int:
    """Return the length of a potential partial </thinking> suffix at end of text."""
    close_tag = "</thinking>"
    for length in range(len(close_tag) - 1, 0, -1):
        if text.endswith(close_tag[:length]):
            return length
    return 0


def extract_json(output_text: str) -> dict:
    """
    Parse the JSON object from the model's output section.
    Handles stray whitespace and optional markdown fencing defensively.
    """
    text = output_text.strip()
    # Strip optional markdown fences
    text = re.sub(r"^```(?:json)?\n?", "", text)
    text = re.sub(r"\n?```$", "", text)
    text = text.strip()

    if not text:
        raise ValueError("Model produced empty output — no JSON to parse")

    try:
        return json.loads(text)
    except json.JSONDecodeError as exc:
        # Attempt to locate the first complete JSON object
        match = re.search(r"\{.*\}", text, re.DOTALL)
        if match:
            return json.loads(match.group())
        raise ValueError(f"Could not parse JSON from model output: {exc}") from exc


async def generate_table_data(json_data: dict) -> dict:
    """
    Ask the Hermes agent to reorganize already-extracted JSON into table form.

    Makes a single non-streaming Hermes call and returns a dict shaped like
    ``{"tables": [{"title", "columns", "rows"}, ...]}``.  Raises on failure so the
    caller can decide how to degrade (the worker treats this as non-fatal).
    """
    client, model = _make_hermes_client()

    payload = json.dumps(json_data, ensure_ascii=False, indent=2)
    if len(payload) > MAX_DOCUMENT_CHARS:
        payload = payload[:MAX_DOCUMENT_CHARS] + "\n\n[... truncated ...]"

    logger.info("Requesting tabular formatting from Hermes model '%s'", model)

    response = await client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": TABLE_SYSTEM_PROMPT},
            {"role": "user", "content": f"JSON to tabulate:\n\n{payload}"},
        ],
        stream=False,
        max_tokens=MAX_TOKENS,
    )

    content = (response.choices[0].message.content or "") if response.choices else ""
    parsed = extract_json(content)

    tables = parsed.get("tables") if isinstance(parsed, dict) else None
    if not isinstance(tables, list):
        raise ValueError("Hermes table output missing a 'tables' array")

    return {"tables": tables}
