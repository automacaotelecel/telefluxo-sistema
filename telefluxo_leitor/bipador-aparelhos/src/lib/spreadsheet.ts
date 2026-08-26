import { extractImeis } from "./imei";
import { makeId } from "./audit";
import type { ImportResult, StockItem } from "./types";

type SheetCell = string | number | boolean | Date | null | undefined;

const aliases = {
  imei: ["imei", "imei 1", "imei1", "imei principal", "numero imei", "n imei"],
  imei2: ["imei 2", "imei2", "imei secundario", "segundo imei"],
  brand: ["marca", "fabricante", "brand"],
  model: ["modelo", "aparelho", "produto", "descricao", "description"],
  color: ["cor", "color"],
  storage: ["armazenamento", "capacidade", "memoria", "storage"],
  serial: ["serial", "numero de serie", "n serie", "sn"],
  location: ["localizacao", "local", "loja", "filial", "deposito", "estoque"],
} as const;

function normalizeHeader(value: SheetCell) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsvLine(line: string, separator: string) {
  const values: string[] = [];
  let current = "";
  let quoted = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      if (quoted && line[index + 1] === '"') {
        current += '"';
        index += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === separator && !quoted) {
      values.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }
  values.push(current.trim());
  return values;
}

async function readRows(file: File): Promise<SheetCell[][]> {
  const extension = file.name.split(".").pop()?.toLowerCase();
  if (extension === "csv" || extension === "txt") {
    const text = (await file.text()).replace(/^\uFEFF/, "");
    const firstLine = text.split(/\r?\n/).find(Boolean) ?? "";
    const separator = (firstLine.match(/;/g)?.length ?? 0) >= (firstLine.match(/,/g)?.length ?? 0) ? ";" : ",";
    return text
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .map((line) => parseCsvLine(line, separator));
  }

  if (extension !== "xlsx") {
    throw new Error("Formato não suportado. Use uma planilha .xlsx ou um arquivo .csv.");
  }

  const { default: readXlsxFile } = await import("read-excel-file");
  return (await readXlsxFile(file)) as SheetCell[][];
}

function findHeaderRow(rows: SheetCell[][]) {
  let bestIndex = -1;
  let bestScore = 0;

  rows.slice(0, 12).forEach((row, index) => {
    const headers = row.map(normalizeHeader);
    let score = 0;

    Object.values(aliases).forEach((options) => {
      if (headers.some((header) => options.includes(header as never))) score += 1;
    });
    if (headers.some((header) => header.includes("imei"))) score += 3;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });

  return bestScore >= 3 ? bestIndex : -1;
}

function findColumn(headers: string[], options: readonly string[]) {
  return headers.findIndex((header) => options.includes(header));
}

function cellText(row: SheetCell[], index: number) {
  if (index < 0) return "";
  const value = row[index];
  if (value instanceof Date) return value.toLocaleDateString("pt-BR");
  return String(value ?? "").trim();
}

export async function parseInventoryFile(file: File): Promise<ImportResult> {
  const rows = await readRows(file);
  if (rows.length === 0) throw new Error("A planilha está vazia.");

  const headerIndex = findHeaderRow(rows);
  const headers = headerIndex >= 0 ? rows[headerIndex].map(normalizeHeader) : [];
  const dataStartIndex = headerIndex >= 0 ? headerIndex + 1 : 0;
  const dataRows = rows.slice(dataStartIndex);

  const columns = {
    imei: findColumn(headers, aliases.imei),
    imei2: findColumn(headers, aliases.imei2),
    brand: findColumn(headers, aliases.brand),
    model: findColumn(headers, aliases.model),
    color: findColumn(headers, aliases.color),
    storage: findColumn(headers, aliases.storage),
    serial: findColumn(headers, aliases.serial),
    location: findColumn(headers, aliases.location),
  };

  const seenImeis = new Set<string>();
  const items: StockItem[] = [];
  let ignoredRows = 0;
  let duplicateRows = 0;

  dataRows.forEach((row, rowIndex) => {
    // A coluna A é tratada como fonte prioritária quando não existe cabeçalho.
    // Isso cobre diretamente planilhas simples em que os IMEIs começam em A1.
    const firstColumnImeis = headerIndex < 0 ? extractImeis(row[0]) : [];
    const mappedImeis = [
      ...extractImeis(cellText(row, columns.imei)),
      ...extractImeis(cellText(row, columns.imei2)),
    ];
    const fallbackImeis = row.flatMap((cell) => extractImeis(cell));
    const imeis = [
      ...new Set(
        headerIndex < 0
          ? [...firstColumnImeis, ...fallbackImeis]
          : mappedImeis.length
            ? mappedImeis
            : fallbackImeis,
      ),
    ];
    const availableImeis = imeis.filter((imei) => !seenImeis.has(imei));

    if (imeis.length > 0 && availableImeis.length === 0) {
      duplicateRows += 1;
      return;
    }

    if (availableImeis.length === 0) {
      ignoredRows += 1;
      return;
    }

    const [imei, imei2] = availableImeis;
    seenImeis.add(imei);
    if (imei2) seenImeis.add(imei2);

    items.push({
      id: makeId("item"),
      imei,
      imei2,
      brand: cellText(row, columns.brand),
      model: cellText(row, columns.model),
      color: cellText(row, columns.color),
      storage: cellText(row, columns.storage),
      serial: cellText(row, columns.serial),
      location: cellText(row, columns.location),
      sourceRow: dataStartIndex + rowIndex + 1,
    });
  });

  if (items.length === 0) {
    throw new Error("Nenhum IMEI de 15 dígitos foi encontrado. Se a sua planilha for uma lista simples, coloque os IMEIs na coluna A começando em A1.");
  }

  return {
    items,
    totalRows: dataRows.length,
    ignoredRows,
    duplicateRows,
  };
}
