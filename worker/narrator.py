"""Tidy Narrator — gives the processing pipeline a warm, first-person voice.

Each pipeline stage is turned into a single short line spoken *as Tidy* to the
user, generated dynamically with a small/fast OpenAI model so the phrasing varies
run-to-run.  Every event ships a Tidy-voiced static fallback, so if no OpenAI key
is configured, narration is disabled, or a call errors/times out, the pipeline
still produces friendly text and never blocks or breaks.

Lines are emitted by the worker as `thinking` tokens, reusing the existing relay,
persistence, and client rendering — the narrator only produces the text.
"""

from __future__ import annotations

import logging
import os

from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

NARRATION_ENABLED = os.environ.get("NARRATION_ENABLED", "true").lower() not in (
    "false",
    "0",
    "no",
)
NARRATION_MODEL = os.environ.get("NARRATION_MODEL", "gpt-4o-mini")
NARRATION_TIMEOUT = float(os.environ.get("NARRATION_TIMEOUT", 15))
# Keep replies to a single short sentence.
NARRATION_MAX_TOKENS = int(os.environ.get("NARRATION_MAX_TOKENS", 60))

SYSTEM_PROMPT = """You are Tidy, a friendly, upbeat document-parsing assistant.

You are narrating your own work to the user in real time, in the FIRST PERSON
("I'm...", "Let me...", "I've..."). Each turn you write exactly ONE short, warm
sentence (about 6-14 words) describing what you are doing right now.

Rules:
- Speak naturally and conversationally, like a helpful colleague.
- You do ALL of this work yourself. Never refer to a separate model, parser,
  engine, AI, or tool — there is no "it", only you. Use "I"/"me"/"my".
- Use any facts you are given (file name, sizes, counts, timing) EXACTLY as
  provided — never invent or alter numbers or names.
- Do not greet the user again after the first line; keep the flow moving.
- No emojis, no markdown, no quotes, no numbered prefixes. Plain text only.
- Output only the sentence itself."""


class Narrator:
    """Produces Tidy-voiced narration lines for one job, with continuity."""

    def __init__(self) -> None:
        self._history: list[dict[str, str]] = []
        self._client: AsyncOpenAI | None = None

        api_key = os.environ.get("OPENAI_API_KEY")
        if NARRATION_ENABLED and api_key:
            try:
                self._client = AsyncOpenAI(api_key=api_key, timeout=NARRATION_TIMEOUT)
            except Exception:  # pragma: no cover - defensive
                logger.exception("Failed to init narration client; using fallbacks")
                self._client = None
        elif NARRATION_ENABLED and not api_key:
            logger.info("OPENAI_API_KEY not set — narration uses static fallbacks")

    async def say(self, intent: str, fallback: str) -> str:
        """Return a single Tidy-voiced sentence for `intent` (no trailing newline).

        `intent` is a terse instruction with the facts to convey (e.g.
        "I just loaded the PDF: 226.3 KB"). `fallback` is the Tidy-voiced static
        line used verbatim when dynamic generation is unavailable or fails.
        The caller is responsible for layout (numbering, indentation, spacing).
        """
        line = await self._generate(intent)
        if line is None:
            line = fallback
        line = line.strip()

        # Record both sides so subsequent lines stay coherent and non-repetitive.
        self._history.append({"role": "user", "content": intent})
        self._history.append({"role": "assistant", "content": line})

        return line

    async def _generate(self, intent: str) -> str | None:
        if self._client is None:
            return None

        messages: list[dict[str, str]] = [{"role": "system", "content": SYSTEM_PROMPT}]
        # Include recent context for flow, but cap to keep prompts small.
        messages.extend(self._history[-8:])
        messages.append({"role": "user", "content": intent})

        try:
            resp = await self._client.chat.completions.create(
                model=NARRATION_MODEL,
                messages=messages,
                max_tokens=NARRATION_MAX_TOKENS,
            )
        except Exception as exc:
            logger.warning("Narration call failed (%s); using fallback", exc)
            return None

        if not resp.choices:
            return None
        text = (resp.choices[0].message.content or "").strip()
        return text or None
