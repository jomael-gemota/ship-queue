/**
 * File types the Tidy worker can read. Mirrors `PARSEABLE` in
 * `frontend/src/components/docTidy/AttachmentCell.tsx` and `file_kind` in
 * `worker/tabular_reader.py`.
 *
 * See design-log/2026-10-22-csv-excel-invoice-parsing.md.
 */

const MIME_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  csv: 'text/csv',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  xls: 'application/vnd.ms-excel',
};

export const PARSEABLE_FILES_LABEL = 'PDF, CSV or Excel (.xlsx, .xls)';

function extensionOf(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot === -1 ? '' : filename.slice(dot + 1).toLowerCase();
}

export function isParseableFilename(filename: string | undefined | null): boolean {
  return Boolean(filename) && extensionOf(filename as string) in MIME_TYPES;
}

export function mimeTypeForParseable(filename: string): string {
  return MIME_TYPES[extensionOf(filename)] ?? 'application/octet-stream';
}
