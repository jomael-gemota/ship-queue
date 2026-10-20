import ExcelJS from 'exceljs';

export const HH_EXPORT_HEADERS = ['Order ID', 'PO Number', 'Reference Number'] as const;

export interface HhExportRow {
  orderId: string;
  po: string;
  referenceNumber: string;
}

function asText(value: string): string {
  return value.trim();
}

export function hhExportFileName(slug: string, sourceFileName: string, groupId: string): string {
  const stem = sourceFileName
    .replace(/\.[^.]+$/, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .toLowerCase();
  const shortId = groupId.replace(/[^a-f0-9]/gi, '').slice(-6) || 'batch';
  const base = stem ? `${slug}-${stem}-${shortId}` : `${slug}-${shortId}`;
  return `${base}.xlsx`;
}

export async function buildHhBatchExportXlsx(rows: HhExportRow[]): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet('Orders');
  sheet.columns = [
    { header: HH_EXPORT_HEADERS[0], key: 'orderId', width: 24 },
    { header: HH_EXPORT_HEADERS[1], key: 'po', width: 16 },
    { header: HH_EXPORT_HEADERS[2], key: 'referenceNumber', width: 20 },
  ];
  sheet.getRow(1).font = { bold: true };

  for (const row of rows) {
    const added = sheet.addRow({
      orderId: asText(row.orderId),
      po: asText(row.po),
      referenceNumber: asText(row.referenceNumber),
    });
    added.eachCell((cell) => {
      cell.numFmt = '@';
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return Buffer.from(buffer);
}
