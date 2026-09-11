"""Retrieve relevant past corrections to inject as few-shot examples.

Implements the retrieval half of the correction feedback loop (see
design-log/2026-06-25-sku-extraction-learning-system.md). For each new document
we embed a text sample and score it against stored correction embeddings,
returning the top-K most similar above a threshold.

MVP scoring is in-Python cosine over a capped candidate set, which is plenty
given corrections are sparse per vendor. The ``retrieve_examples`` interface is
intentionally stable so it can be swapped for MongoDB Atlas ``$vectorSearch``
later without touching callers.
"""

from __future__ import annotations

import logging
import math
import os
import re
from dataclasses import dataclass

from embeddings import embed_text
from mongo_collections import CORRECTIONS
from sku import normalize_vendor_name

logger = logging.getLogger(__name__)

CORRECTIONS_ENABLED = os.environ.get("CORRECTIONS_ENABLED", "true").lower() not in (
    "false",
    "0",
    "no",
)
CORRECTION_TOP_K = int(os.environ.get("CORRECTION_TOP_K", 3))
CORRECTION_MIN_SCORE = float(os.environ.get("CORRECTION_MIN_SCORE", 0.75))
CORRECTION_CANDIDATE_LIMIT = int(os.environ.get("CORRECTION_CANDIDATE_LIMIT", 500))
# Characters of source text used for the embedding sample (must be the same
# sample the server embedded when the correction was stored).
CORRECTION_TEXT_SAMPLE_CHARS = int(os.environ.get("CORRECTION_TEXT_SAMPLE_CHARS", 2000))
# When the document's vendor is known but has no stored corrections, stay silent
# rather than borrowing another vendor's fixes. Set false to allow a global
# similarity fallback in that case.
CORRECTION_VENDOR_STRICT = os.environ.get("CORRECTION_VENDOR_STRICT", "true").lower() not in (
    "false",
    "0",
    "no",
)


@dataclass
class Example:
    document_text_sample: str
    corrected_output: dict
    note: str | None
    score: float


def _cosine(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    if na == 0 or nb == 0:
        return 0.0
    return dot / (na * nb)


async def retrieve_examples(
    db,
    document_text: str,
    vendor_name: str | None = None,
) -> list[Example]:
    """Return up to ``CORRECTION_TOP_K`` past corrections relevant to this document.

    Retrieval is **vendor-scoped**: when ``vendor_name`` is known, only that
    vendor's corrections are considered, so one vendor's fixes never leak into
    another's. If the known vendor has no corrections, returns ``[]`` (unless
    ``CORRECTION_VENDOR_STRICT`` is disabled, in which case it falls back to a
    global similarity search). When the vendor is unknown (new/unregistered),
    falls back to global similarity. Returns ``[]`` (graceful no-op) when
    disabled, unembeddable, or empty.
    """
    if not CORRECTIONS_ENABLED:
        return []

    sample = document_text[:CORRECTION_TEXT_SAMPLE_CHARS]
    query = await embed_text(sample)
    if query is None:
        return []

    projection = {
        "documentTextSample": 1,
        "correctedOutput": 1,
        "embedding": 1,
        "note": 1,
        "vendorName": 1,
    }
    base_filter = {"embedding": {"$ne": None}}
    try:
        # Most-recent corrections globally — covers cold start, unknown vendors,
        # and the cross-vendor fallback.
        cursor = db[CORRECTIONS].find(base_filter, projection=projection).sort(
            "createdAt", -1
        ).limit(CORRECTION_CANDIDATE_LIMIT)
        candidates = await cursor.to_list(length=CORRECTION_CANDIDATE_LIMIT)

        # When the vendor is known, ALSO pull that vendor's corrections directly so
        # a learned format is never crowded out of the global recency window — it is
        # remembered for that vendor forever, regardless of total correction volume.
        # SKU formats now live entirely in corrections (see design-log
        # 2026-06-25-llm-built-skus-per-vendor.md), so this retrieval must be
        # reliable. Matched case-insensitively with surrounding whitespace tolerated;
        # the global set above remains a fallback if the name doesn't match exactly.
        if vendor_name:
            vendor_filter = {
                **base_filter,
                "vendorName": {
                    "$regex": rf"^\s*{re.escape(vendor_name.strip())}\s*$",
                    "$options": "i",
                },
            }
            vcursor = db[CORRECTIONS].find(vendor_filter, projection=projection).sort(
                "createdAt", -1
            ).limit(CORRECTION_CANDIDATE_LIMIT)
            vendor_candidates = await vcursor.to_list(length=CORRECTION_CANDIDATE_LIMIT)
            seen = {str(c.get("_id")) for c in candidates}
            for cand in vendor_candidates:
                if str(cand.get("_id")) not in seen:
                    candidates.append(cand)
    except Exception as exc:
        logger.warning("Correction retrieval query failed: %s", exc)
        return []

    norm_vendor = normalize_vendor_name(vendor_name) if vendor_name else ""

    # Partition scored candidates into this vendor's corrections vs. all others
    # so we can prefer (and, when strict, restrict to) the same vendor.
    same_vendor: list[Example] = []
    other_vendor: list[Example] = []
    for doc in candidates:
        if not isinstance(doc.get("correctedOutput"), dict):
            continue
        score = _cosine(query, doc.get("embedding") or [])
        if score < CORRECTION_MIN_SCORE:
            continue
        example = Example(
            document_text_sample=doc.get("documentTextSample", ""),
            corrected_output=doc["correctedOutput"],
            note=doc.get("note"),
            score=score,
        )
        cand_vendor = normalize_vendor_name(doc.get("vendorName") or "")
        if norm_vendor and cand_vendor == norm_vendor:
            same_vendor.append(example)
        else:
            other_vendor.append(example)

    if norm_vendor:
        if same_vendor:
            chosen = same_vendor
        elif CORRECTION_VENDOR_STRICT:
            # Known vendor with no corrections of its own — stay silent rather
            # than borrowing another vendor's fixes.
            chosen = []
        else:
            chosen = other_vendor
    else:
        # Vendor unknown (cold start) — best-effort global similarity.
        chosen = same_vendor + other_vendor

    chosen.sort(key=lambda e: e.score, reverse=True)
    top = chosen[:CORRECTION_TOP_K]
    if top:
        scope = f"vendor '{vendor_name}'" if (norm_vendor and same_vendor) else "global"
        logger.info(
            "Retrieved %d correction example(s) [%s scope] (top score %.3f)",
            len(top),
            scope,
            top[0].score,
        )
    return top
