"""Vendor identification + line-item helpers.

Tidy (the LLM) now *builds the SKU string itself*, learning each vendor's format
from past corrections (see design-log/2026-06-25-llm-built-skus-per-vendor.md).
This module no longer assembles SKUs deterministically; it only locates line
items, pulls the vendor name out of extracted JSON, and resolves/detects vendors
against the vendors collection so corrections can be scoped per vendor.
"""

from __future__ import annotations

import logging
import re

from mongo_collections import VENDORS

logger = logging.getLogger(__name__)

# Keys (case-insensitive) under which the extracted JSON may carry the vendor name.
_VENDOR_NAME_KEYS = ("vendorName", "vendor", "supplier", "brand", "manufacturer")

# Keys (case-insensitive) under which the extracted JSON may carry line items.
_LINE_ITEM_KEYS = ("lineItems", "line_items", "items", "products", "rows")


def find_line_items(json_data: dict) -> tuple[str | None, list]:
    """Return the (key, list) of line items in the extracted JSON, if any."""
    if not isinstance(json_data, dict):
        return None, []
    lowered = {k.lower(): k for k in json_data}
    for candidate in _LINE_ITEM_KEYS:
        actual = lowered.get(candidate.lower())
        if actual and isinstance(json_data[actual], list):
            return actual, json_data[actual]
    return None, []


def extract_vendor_name(json_data: dict) -> str | None:
    """Pull the vendor/brand name out of the extracted JSON, if present."""
    if not isinstance(json_data, dict):
        return None
    lowered = {k.lower(): k for k in json_data}
    for candidate in _VENDOR_NAME_KEYS:
        actual = lowered.get(candidate.lower())
        if actual and isinstance(json_data[actual], str) and json_data[actual].strip():
            return json_data[actual].strip()
    return None


def normalize_vendor_name(name: str) -> str:
    """Canonical key for vendor matching: lowercased, collapsed whitespace."""
    return re.sub(r"\s+", " ", name.strip().lower())


async def resolve_vendor(db, vendor_name: str | None) -> dict | None:
    """Look up a vendor record by (normalized) name in the vendors collection.

    Returns the vendor document or ``None`` if the name is empty or unknown.
    """
    if not vendor_name:
        return None
    try:
        normalized = normalize_vendor_name(vendor_name)
        return await db[VENDORS].find_one({"normalizedName": normalized})
    except Exception as exc:  # DB hiccup shouldn't fail the whole job
        logger.warning("Vendor lookup failed for %r: %s", vendor_name, exc)
        return None


async def detect_vendor_name_from_text(db, document_text: str) -> str | None:
    """Best-effort vendor identification from RAW text, *before* extraction.

    Correction retrieval runs before the LLM extracts structured fields, so the
    extracted ``vendorName`` isn't available yet. To scope retrieval by vendor we
    match the document text against the names of already-registered vendors and
    return the matching vendor's **canonical** name. Longest match wins so a short
    name never shadows a more specific one. Returns ``None`` when no registered
    vendor is found (new/unregistered vendor → caller falls back to global search).
    """
    if not document_text:
        return None
    try:
        vendors = await db[VENDORS].find(
            {}, projection={"name": 1, "normalizedName": 1}
        ).to_list(length=1000)
    except Exception as exc:  # DB hiccup shouldn't fail the whole job
        logger.warning("Vendor list lookup failed: %s", exc)
        return None

    haystack = normalize_vendor_name(document_text)
    best_name: str | None = None
    best_len = 0
    for vendor in vendors:
        name = (vendor.get("name") or "").strip()
        normalized = vendor.get("normalizedName") or normalize_vendor_name(name)
        if normalized and normalized in haystack and len(normalized) > best_len:
            best_name = name or normalized
            best_len = len(normalized)

    if best_name:
        logger.info("Detected vendor %r from document text", best_name)
    return best_name
