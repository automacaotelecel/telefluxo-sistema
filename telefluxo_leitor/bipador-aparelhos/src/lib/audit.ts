import type { AuditSession, AuditStats, ScanEvent, StockItem } from "./types";
import { appendImeiCheckDigit } from "./imei";

export const STORAGE_KEY = "telefluxo_inventory_manager_v1";

export function makeId(prefix: string) {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

export function checkedItemIds(audit: AuditSession) {
  return new Set(
    audit.scans
      .filter((scan) => scan.result === "found" && scan.itemId)
      .map((scan) => scan.itemId as string),
  );
}

export function uniqueUnexpected(audit: AuditSession) {
  const seen = new Set<string>();
  return audit.scans.filter((scan) => {
    if (scan.result !== "unexpected" || seen.has(scan.imei)) return false;
    seen.add(scan.imei);
    return true;
  });
}

export function getAuditStats(audit?: AuditSession | null): AuditStats {
  if (!audit) {
    return { expected: 0, checked: 0, pending: 0, unexpected: 0, duplicates: 0, invalid: 0, progress: 0 };
  }

  const checked = checkedItemIds(audit).size;
  const expected = audit.items.length;
  return {
    expected,
    checked,
    pending: Math.max(expected - checked, 0),
    unexpected: uniqueUnexpected(audit).length,
    duplicates: audit.scans.filter((scan) => scan.result === "duplicate").length,
    invalid: audit.scans.filter((scan) => scan.result === "invalid").length,
    progress: expected === 0 ? 0 : Math.round((checked / expected) * 100),
  };
}

export function formatDateTime(value?: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(value));
}

export function formatDateLong(value: Date | string = new Date()) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long",
    day: "2-digit",
    month: "long",
    year: "numeric",
  }).format(new Date(value));
}

export function createDemoAudit(): AuditSession {
  const started = new Date(Date.now() - 42 * 60 * 1000);
  const models = [
    ["Samsung", "Galaxy A55 5G", "Azul", "256 GB"],
    ["Samsung", "Galaxy S24", "Preto", "256 GB"],
    ["Motorola", "Moto G85 5G", "Grafite", "256 GB"],
    ["Apple", "iPhone 15", "Rosa", "128 GB"],
    ["Xiaomi", "Redmi Note 13", "Preto", "256 GB"],
    ["Samsung", "Galaxy A35 5G", "Lilás", "128 GB"],
    ["Motorola", "Edge 50 Fusion", "Azul", "256 GB"],
    ["Apple", "iPhone 14", "Estelar", "128 GB"],
    ["Xiaomi", "Poco X6 Pro", "Amarelo", "512 GB"],
    ["Samsung", "Galaxy S24 FE", "Cinza", "256 GB"],
    ["Motorola", "Moto G55 5G", "Verde", "256 GB"],
    ["Samsung", "Galaxy A16", "Preto", "128 GB"],
  ];

  const items: StockItem[] = models.map(([brand, model, color, storage], index) => ({
    id: `demo_item_${index + 1}`,
    imei: appendImeiCheckDigit(`35693803564${String(300 + index).padStart(3, "0")}`),
    imei2: index % 3 === 0 ? appendImeiCheckDigit(`49015420323${String(700 + index).padStart(3, "0")}`) : undefined,
    brand,
    model,
    color,
    storage,
    serial: `SN-TF-${String(index + 1).padStart(4, "0")}`,
    location: index < 8 ? "Loja Centro" : "Estoque principal",
    sourceRow: index + 2,
  }));

  const scans: ScanEvent[] = items.slice(0, 7).map((item, index) => ({
    id: `demo_scan_${index + 1}`,
    imei: item.imei,
    rawValue: item.imei,
    result: "found",
    itemId: item.id,
    operator: "adm",
    createdAt: new Date(started.getTime() + (index + 1) * 4 * 60 * 1000).toISOString(),
  }));

  scans.unshift({
    id: "demo_unexpected_1",
    imei: appendImeiCheckDigit("86256104290314"),
    rawValue: appendImeiCheckDigit("86256104290314"),
    result: "unexpected",
    operator: "adm",
    createdAt: new Date(Date.now() - 6 * 60 * 1000).toISOString(),
  });

  return {
    id: "demo_audit",
    name: "Conferência de demonstração",
    branch: "Loja Centro",
    responsible: "adm",
    status: "active",
    sourceFile: "estoque_demonstracao.xlsx",
    importedAt: started.toISOString(),
    startedAt: started.toISOString(),
    ignoredRows: 0,
    duplicateRows: 0,
    items,
    scans,
    demo: true,
  };
}

export function loadAudits() {
  if (typeof window === "undefined") return [] as AuditSession[];
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (!saved) return [] as AuditSession[];
    const parsed = JSON.parse(saved) as AuditSession[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    window.localStorage.removeItem(STORAGE_KEY);
    return [] as AuditSession[];
  }
}

export function saveAudits(audits: AuditSession[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(audits));
}
