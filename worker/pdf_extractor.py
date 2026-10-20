"""Extract text + tables from a PDF, routing scanned pages through local OCR.

Strategy (see design-log/2026-06-25-sku-extraction-learning-system.md):

- **Digital pages** — use ``pdfplumber`` for both the running text *and*
  ``page.extract_tables()`` so the line-item column structure (Style | Color |
  Size | Width | Qty) survives into the prompt.
- **Scanned pages** — pages with little/no extractable text are rasterized and
  read with **local OCR** (Tesseract via ``pytesseract`` + ``pdf2image``).
- **Graceful degradation** — if the OCR libraries/binaries are unavailable, the
  scanned page is skipped with a warning instead of crashing, so digital-only
  PDFs keep working exactly as before.
"""

from __future__ import annotations

import io
import logging
import os

import pdfplumber

logger = logging.getLogger(__name__)

# A page whose embedded text has fewer than this many non-whitespace characters
# is treated as scanned and routed to OCR.
SCANNED_TEXT_THRESHOLD = int(os.environ.get("SCANNED_TEXT_THRESHOLD", 20))

# DPI used when rasterizing scanned pages for OCR. 300 is the usual sweet spot
# for Tesseract on document text; raise for tiny fonts, lower for speed.
OCR_DPI = int(os.environ.get("OCR_DPI", 300))

# Master switch — set OCR_ENABLED=false to force the legacy text-only behavior.
OCR_ENABLED = os.environ.get("OCR_ENABLED", "true").lower() not in ("false", "0", "no")


def _format_table(table: list[list[str | None]]) -> str:
    """Render an extracted table as pipe-delimited rows for the prompt.

    Cells are stringified and ``None`` becomes empty. Keeping a simple, regular
    grid helps the model line up sizes/widths/qty with their column headers.
    """
    lines: list[str] = []
    for row in table:
        cells = [(cell if cell is not None else "").strip().replace("\n", " ") for cell in row]
        if any(cells):
            lines.append(" | ".join(cells))
    return "\n".join(lines)


def _ocr_page(pdf_bytes: bytes, page_number: int) -> str:
    """OCR a single (1-indexed) page with local Tesseract.

    Imports are lazy so the worker still runs for digital-only PDFs on machines
    without OCR installed. Returns ``""`` (and logs) when OCR is unavailable or
    fails, so the caller can degrade gracefully.
    """
    if not OCR_ENABLED:
        return ""

    try:
        import pytesseract  # type: ignore
        from pdf2image import convert_from_bytes  # type: ignore
    except ImportError:
        logger.warning(
            "Page %d looks scanned but OCR libraries are not installed "
            "(need pytesseract + pdf2image). Skipping OCR for this page.",
            page_number,
        )
        return ""

    try:
        images = convert_from_bytes(
            pdf_bytes,
            dpi=OCR_DPI,
            first_page=page_number,
            last_page=page_number,
        )
    except Exception as exc:  # poppler missing, corrupt page, etc.
        logger.warning("Page %d: rasterization for OCR failed: %s", page_number, exc)
        return ""

    if not images:
        return ""

    try:
        text = pytesseract.image_to_string(images[0])
    except Exception as exc:  # tesseract binary missing, etc.
        logger.warning("Page %d: Tesseract OCR failed: %s", page_number, exc)
        return ""

    return text.strip()


def _extract_page(pdf_bytes: bytes, page, page_number: int) -> str:
    """Return the combined text + tables for a single page, OCR-ing if scanned."""
    text = (page.extract_text() or "").strip()

    if len(text.replace(" ", "").replace("\n", "")) < SCANNED_TEXT_THRESHOLD:
        ocr_text = _ocr_page(pdf_bytes, page_number)
        if ocr_text:
            logger.info("Page %d: read via OCR (%d chars)", page_number, len(ocr_text))
            return ocr_text
        # Fall through: keep whatever sparse text we had (possibly empty).

    parts: list[str] = []
    if text:
        parts.append(text)

    try:
        tables = page.extract_tables() or []
    except Exception as exc:
        logger.debug("Page %d: table extraction failed: %s", page_number, exc)
        tables = []

    for idx, table in enumerate(tables, start=1):
        rendered = _format_table(table)
        if rendered:
            parts.append(f"[Table {idx}]\n{rendered}")

    return "\n\n".join(parts).strip()


def extract_text(pdf_bytes: bytes) -> str:
    """Return the full text of a PDF, one page at a time, separated by newlines.

    Digital pages contribute their running text plus any detected tables;
    scanned pages are read with local OCR. Tables are rendered as pipe-delimited
    rows so column structure (critical for line-item / SKU extraction) is
    preserved for the model.
    """
    pages: list[str] = []

    with pdfplumber.open(io.BytesIO(pdf_bytes)) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            page_content = _extract_page(pdf_bytes, page, i)
            if page_content:
                pages.append(f"--- Page {i} ---\n{page_content}")
            else:
                logger.debug("Page %d produced no text (even after OCR attempt)", i)

    if not pages:
        raise ValueError(
            "No extractable text found in the PDF. "
            "If this is a scanned document, ensure local OCR is installed "
            "(Tesseract + poppler) and OCR_ENABLED is not set to false."
        )

    return "\n\n".join(pages)
