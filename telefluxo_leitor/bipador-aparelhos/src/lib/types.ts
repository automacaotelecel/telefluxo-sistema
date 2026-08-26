export type AuditStatus = "active" | "paused" | "completed";

export type ScanResult = "found" | "unexpected" | "duplicate" | "invalid";

export type ViewKey =
  | "dashboard"
  | "new-audit"
  | "scanner"
  | "inventory"
  | "divergences"
  | "history"
  | "reports";

export interface StockItem {
  id: string;
  imei: string;
  imei2?: string;
  brand?: string;
  model?: string;
  color?: string;
  storage?: string;
  serial?: string;
  location?: string;
  sourceRow: number;
}

export interface ScanEvent {
  id: string;
  imei: string;
  rawValue: string;
  result: ScanResult;
  createdAt: string;
  itemId?: string;
  operator: string;
}

export interface AuditSession {
  id: string;
  name: string;
  branch: string;
  responsible: string;
  status: AuditStatus;
  sourceFile: string;
  importedAt: string;
  startedAt: string;
  completedAt?: string;
  ignoredRows: number;
  duplicateRows: number;
  items: StockItem[];
  scans: ScanEvent[];
  demo?: boolean;
}

export interface ImportResult {
  items: StockItem[];
  totalRows: number;
  ignoredRows: number;
  duplicateRows: number;
}

export interface AuditStats {
  expected: number;
  checked: number;
  pending: number;
  unexpected: number;
  duplicates: number;
  invalid: number;
  progress: number;
}
