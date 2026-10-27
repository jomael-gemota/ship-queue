"""PO number canonicalisation.

Invoices print the buyer's PO under many labels — "Customer PO Number",
"Customer Reference", "Your Ref", … — and every downstream PO match reads a
single field. Tidy is prompted to emit a top-level ``poNumber``; this module is
the deterministic safety net for when it doesn't (see
design-log/2026-10-21-customer-po-as-po-number.md).
"""

from __future__ import annotations

import re

PO_NUMBER_KEY = "poNumber"

# Priority order. Must stay in step with PO_NUMBER_KEYS in
# src/services/invoiceMatchCache.service.ts.
_PO_ALIASES = (
    "poNumber",
    "purchaseOrderNumber",
    "poNo",
    "po",
    "customerPoNumber",
    "customerPoNo",
    "customerPo",
    "custPoNumber",
    "custPoNo",
    "custPo",
    "customerPurchaseOrder",
    "customerPurchaseOrderNumber",
    "yourPo",
    "yourPoNumber",
    "buyerPo",
    "clientPo",
    "customerReferenceNumber",
    "customerReference",
    "customerRefNo",
    "customerRef",
    "custRef",
    "yourReference",
    "yourRef",
    "purchaseOrder",
)

# Same-line "label: value" in the raw PDF text. The value must contain a digit,
# which keeps a neighbouring column header ("PO Number   Invoice Date") from
# being captured. Plain "P.O." needs a number/no/# suffix so "P.O. Box" is skipped.
_PO_TEXT_PATTERN = re.compile(
    r"(?im)\b(?:"
    r"customer\s*p\.?\s*o\.?(?:\s*(?:number|num|no\.?|#))?"
    r"|cust\.?\s*p\.?\s*o\.?(?:\s*(?:number|num|no\.?|#))?"
    r"|customer\s*purchase\s*order(?:\s*(?:number|num|no\.?|#))?"
    r"|customer\s*ref(?:erence)?\.?(?:\s*(?:number|num|no\.?|#))?"
    r"|cust\.?\s*ref(?:erence)?\.?(?:\s*(?:number|num|no\.?|#))?"
    r"|your\s*(?:p\.?\s*o\.?|ref(?:erence)?\.?)(?:\s*(?:number|num|no\.?|#))?"
    r"|purchase\s*order(?:\s*(?:number|num|no\.?|#))?"
    r"|p\.?\s*o\.?\s*(?:number|num|no\.?|#)"
    r")[ \t]*[:#\-]?[ \t]*(?P<value>[A-Za-z0-9][A-Za-z0-9\-/._]*\d[A-Za-z0-9\-/._]*)"
)


def _norm_key(key: str) -> str:
    return re.sub(r"[^a-z0-9]", "", key.lower())


_ALIAS_RANK = {_norm_key(alias): rank for rank, alias in enumerate(_PO_ALIASES)}


def _scalar(value) -> str | None:
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, str) and value.strip():
        return value.strip()
    return None


def _best_alias_value(obj: dict) -> tuple[int, str] | None:
    best: tuple[int, str] | None = None
    for key, value in obj.items():
        rank = _ALIAS_RANK.get(_norm_key(str(key)))
        text = _scalar(value)
        if rank is None or text is None:
            continue
        if best is None or rank < best[0]:
            best = (rank, text)
    return best


def find_po_number(json_data: dict) -> str | None:
    """The PO number under any known alias: top-level keys first, then nested objects."""
    if not isinstance(json_data, dict):
        return None
    top = _best_alias_value(json_data)
    if top:
        return top[1]
    nested = [
        hit
        for child in json_data.values()
        if isinstance(child, dict)
        for hit in [_best_alias_value(child)]
        if hit
    ]
    return min(nested)[1] if nested else None


def detect_po_number_from_text(document_text: str) -> str | None:
    match = _PO_TEXT_PATTERN.search(document_text or "")
    return match.group("value").rstrip("./-_") if match else None


def ensure_po_number(json_data: dict, document_text: str = "") -> str | None:
    """Fill a missing/empty top-level ``poNumber`` in place; never overwrite one Tidy set.

    Returns the PO number now on the document, or ``None`` if none was found.
    """
    if not isinstance(json_data, dict):
        return None
    current = _scalar(json_data.get(PO_NUMBER_KEY))
    if current:
        return current
    po = find_po_number(json_data) or detect_po_number_from_text(document_text)
    if po:
        json_data[PO_NUMBER_KEY] = po
    return po
