import fs from 'fs';
import path from 'path';
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import {
  OnlineInputProduct,
  OnlineInputWorkbook,
  OnlinePriceAnalysisSummary,
  OnlinePriceResult,
  OnlineStoreTarget,
} from './onlinePrices.types';

const STORE_DOMAIN_MAP: Record<string, string[]> = {
  'MERCADO LIVRE': ['mercadolivre.com.br'],
  MERCADOLIVRE: ['mercadolivre.com.br'],
  CARREFOUR: ['carrefour.com.br'],
  MAGALU: ['magazineluiza.com.br', 'magalu.com.br'],
  'MAGAZINE LUIZA': ['magazineluiza.com.br', 'magalu.com.br'],
  'FAST SHOP': ['fastshop.com.br'],
  FASTSHOP: ['fastshop.com.br'],
  AMAZON: ['amazon.com.br'],
  'SITE SAMSUNG': ['samsung.com.br'],
  SAMSUNG: ['samsung.com.br'],
};

function texto(value: unknown): string {
  return String(value ?? '')
    .replace(/\u00a0/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarLoja(value: unknown): string {
  return texto(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizarSubHeader(value: unknown): string {
  return texto(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/\s+/g, ' ')
    .trim();
}

function toNumberOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'number' && Number.isFinite(value)) return value;

  const raw = texto(value).toUpperCase();
  if (!raw || raw.includes('INDISPON')) return null;

  const cleaned = raw
    .replace(/R\$/g, '')
    .replace(/[^0-9,.-]/g, '')
    .replace(/\.(?=\d{3}(\D|$))/g, '')
    .replace(',', '.')
    .trim();

  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function resolverDominios(loja: string): string[] {
  const normalizada = normalizarLoja(loja);
  const direto = STORE_DOMAIN_MAP[normalizada];
  if (direto && direto.length > 0) return direto;

  const entrada = Object.entries(STORE_DOMAIN_MAP).find(([key]) =>
    normalizada.includes(key) || key.includes(normalizada),
  );

  return entrada?.[1] || [];
}

function getCell(rows: unknown[][], rowIndex: number, colIndex: number): unknown {
  const row = rows[rowIndex];
  if (!row) return null;
  return row[colIndex] ?? null;
}

export function parseOnlinePricesWorkbook(params: {
  fileBuffer: Buffer;
  originalName: string;
}): OnlineInputWorkbook {
  const workbook = XLSX.read(params.fileBuffer, { type: 'buffer', cellDates: false });
  const sheetName = workbook.SheetNames[0];

  if (!sheetName) {
    throw new Error('A planilha enviada não possui abas válidas.');
  }

  const sheet = workbook.Sheets[sheetName];
  if (!sheet) {
    throw new Error('Não foi possível abrir a primeira aba da planilha.');
  }

  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    blankrows: false,
    defval: null,
  });

  if (rows.length < 3) {
    throw new Error('A planilha precisa ter cabeçalho de lojas, subcabeçalho A VISTA/12X e linhas de modelos.');
  }

  const headerRow = rows[0] || [];
  const subHeaderRow = rows[1] || [];
  const lojas: OnlineStoreTarget[] = [];
  let lojaAtual = '';

  for (let col = 1; col < Math.max(headerRow.length, subHeaderRow.length); col += 1) {
    const lojaHeader = texto(headerRow[col]);
    if (lojaHeader) lojaAtual = lojaHeader;

    const subHeader = normalizarSubHeader(subHeaderRow[col]);
    if (!lojaAtual || !subHeader) continue;

    let loja = lojas.find((item) => item.nomeNormalizado === normalizarLoja(lojaAtual));
    if (!loja) {
      loja = {
        nome: lojaAtual,
        nomeNormalizado: normalizarLoja(lojaAtual),
        dominios: resolverDominios(lojaAtual),
      };
      lojas.push(loja);
    }

    if (subHeader.includes('VISTA')) {
      loja.cashColIndex = col;
    } else if (subHeader.includes('12') || subHeader.includes('PRAZO') || subHeader.includes('PARCEL')) {
      loja.termColIndex = col;
    }
  }

  if (lojas.length === 0) {
    throw new Error('Não encontrei lojas no cabeçalho da planilha. Verifique se a primeira linha contém nomes como MERCADO LIVRE, MAGALU, AMAZON etc.');
  }

  const produtos: OnlineInputProduct[] = [];

  for (let rowIndex = 2; rowIndex < rows.length; rowIndex += 1) {
    const modelo = texto(getCell(rows, rowIndex, 0));
    if (!modelo || modelo.toUpperCase() === 'MODELO') continue;

    const valoresPlanilhaPorLoja: OnlineInputProduct['valoresPlanilhaPorLoja'] = {};

    lojas.forEach((loja) => {
      const point: OnlineInputProduct['valoresPlanilhaPorLoja'][string] = {};
      if (typeof loja.cashColIndex === 'number') {
        point.cashColIndex = loja.cashColIndex;
        point.planilhaAvista = toNumberOrNull(getCell(rows, rowIndex, loja.cashColIndex));
      }
      if (typeof loja.termColIndex === 'number') {
        point.termColIndex = loja.termColIndex;
        point.planilhaPrazo12x = toNumberOrNull(getCell(rows, rowIndex, loja.termColIndex));
      }
      valoresPlanilhaPorLoja[loja.nomeNormalizado] = point;
    });

    produtos.push({ modelo, rowIndex, valoresPlanilhaPorLoja });
  }

  if (produtos.length === 0) {
    throw new Error('Não encontrei modelos na primeira coluna da planilha.');
  }

  return {
    sheetName,
    produtos,
    lojas,
    originalName: params.originalName,
  };
}

function formatMoney(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

function safePercent(value: number | null): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.round(value * 10000) / 10000;
}

function addHeaderStyle(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF0F172A' } };
  row.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
}

function applyThinBorder(cell: ExcelJS.Cell) {
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    left: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    bottom: { style: 'thin', color: { argb: 'FFE2E8F0' } },
    right: { style: 'thin', color: { argb: 'FFE2E8F0' } },
  };
}

function sanitizeSheetValue(value: string | null): string {
  return texto(value).slice(0, 32000);
}

export async function gerarRelatorioOnlinePricesExcel(params: {
  input: OnlineInputWorkbook;
  results: OnlinePriceResult[];
  resumo: OnlinePriceAnalysisSummary;
  outputDir: string;
}): Promise<{ fileName: string; fullPath: string; buffer: Buffer }> {
  fs.mkdirSync(params.outputDir, { recursive: true });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Clark IA - Preços Online';
  workbook.created = new Date();

  // Relatório final no mesmo padrão da planilha enviada:
  // MODELO + lojas no cabeçalho + subcolunas A VISTA / 12X.
  // Sem links, sem fonte, sem abas técnicas e sem colunas extras.
  const sheet = workbook.addWorksheet('ONLINE TODOS OS MODELOS');

  const headerRow1 = ['MODELO'];
  const headerRow2 = [''];

  params.input.lojas.forEach((loja) => {
    headerRow1.push(loja.nome, '');
    headerRow2.push('A VISTA', '12X');
  });

  sheet.addRow(headerRow1);
  sheet.addRow(headerRow2);

  sheet.mergeCells(1, 1, 2, 1);

  params.input.lojas.forEach((loja, index) => {
    const firstCol = 2 + index * 2;
    const secondCol = firstCol + 1;
    sheet.mergeCells(1, firstCol, 1, secondCol);
  });

  const byModelStore = new Map<string, OnlinePriceResult>();
  params.results.forEach((result) => {
    byModelStore.set(`${result.modelo}::${result.loja}`, result);
  });

  params.input.produtos.forEach((produto) => {
    const rowValues: Array<string | number | null> = [produto.modelo];

    params.input.lojas.forEach((loja) => {
      const result = byModelStore.get(`${produto.modelo}::${loja.nome}`);
      rowValues.push(
        formatMoney(result?.precoAvistaOnline ?? null),
        formatMoney(result?.precoPrazo12xOnline ?? null),
      );
    });

    sheet.addRow(rowValues);
  });

  // Estilo do cabeçalho igual a uma planilha de levantamento comercial.
  const modelHeader = sheet.getCell('A1');
  modelHeader.value = 'MODELO';
  modelHeader.font = { bold: true, color: { argb: 'FF003366' } };
  modelHeader.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9E2F3' } };
  modelHeader.alignment = { horizontal: 'center', vertical: 'middle' };

  for (let col = 2; col <= sheet.columnCount; col += 1) {
    const row1Cell = sheet.getCell(1, col);
    const row2Cell = sheet.getCell(2, col);

    row1Cell.font = { bold: true, color: { argb: 'FF003366' } };
    row1Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF9DB9E1' } };
    row1Cell.alignment = { horizontal: 'center', vertical: 'middle' };

    row2Cell.font = { bold: true, color: { argb: 'FF003366' } };
    row2Cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFB7C9E2' } };
    row2Cell.alignment = { horizontal: 'center', vertical: 'middle' };
  }

  sheet.getRow(1).height = 24;
  sheet.getRow(2).height = 20;
  sheet.getColumn(1).width = 30;

  for (let col = 2; col <= sheet.columnCount; col += 1) {
    sheet.getColumn(col).width = 15;
    sheet.getColumn(col).numFmt = 'R$ #,##0.00';
  }

  sheet.eachRow((row, rowNumber) => {
    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      applyThinBorder(cell);

      if (rowNumber <= 2) {
        cell.alignment = { horizontal: 'center', vertical: 'middle', wrapText: true };
      } else if (colNumber === 1) {
        cell.alignment = { horizontal: 'left', vertical: 'middle' };
        cell.font = { color: { argb: 'FF0563C1' }, underline: true };
      } else {
        cell.alignment = { horizontal: 'center', vertical: 'middle' };
      }
    });
  });

  sheet.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }];

  const lastColumn = sheet.columnCount;
  const lastRow = Math.max(2, sheet.rowCount);
  sheet.autoFilter = {
    from: { row: 2, column: 1 },
    to: { row: lastRow, column: lastColumn },
  };

  const fileName = `precos-online-${Date.now()}.xlsx`;
  const fullPath = path.join(params.outputDir, fileName);
  const rawBuffer = await workbook.xlsx.writeBuffer();
  const buffer = Buffer.isBuffer(rawBuffer) ? rawBuffer : Buffer.from(rawBuffer);
  fs.writeFileSync(fullPath, buffer);

  return { fileName, fullPath, buffer };
}
