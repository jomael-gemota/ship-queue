import ExcelJS from 'exceljs';
import { cellToString, parseHhImportMatrix, type HhImportParseResult } from './hhImport';

export async function parseHhImportXlsx(buffer: Buffer): Promise<HhImportParseResult> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as Parameters<typeof workbook.xlsx.load>[0]);
  } catch {
    return { error: 'Could not read that spreadsheet. Upload an .xlsx or .csv file.' };
  }

  const sheet = workbook.worksheets[0];
  if (!sheet) return { error: 'The spreadsheet has no sheets.' };

  const columnCount = Math.max(sheet.columnCount, 2);
  const rows: string[][] = [];
  sheet.eachRow((row) => {
    const cells: string[] = [];
    for (let col = 1; col <= columnCount; col += 1) {
      cells.push(cellToString(row.getCell(col).value));
    }
    rows.push(cells);
  });

  return parseHhImportMatrix(rows);
}
