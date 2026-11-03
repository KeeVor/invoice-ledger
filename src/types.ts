export type Fields = {
  invoiceNumber: string;
  invoiceCode: string;
  invoiceDate: string;
  invoiceType: string;
  buyerName: string;
  sellerName: string;
  buyerTaxId: string;
  sellerTaxId: string;
  itemName: string;
  category: string;
  attribution: string;
  amountCents: number | null;
  taxCents: number | null;
  totalCents: number | null;
  notes: string;
};
export type Duplicate = {
  id: string;
  invoiceNumber: string;
  createdAt: string;
  archived: number;
};
export type Draft = Fields & {
  id: string;
  documentId: string;
  originalName: string;
  page: number;
  source: string;
  warnings: string[];
  rawText: string;
  duplicate?: Duplicate;
  createdAt: string;
};
export type Invoice = Fields & {
  id: string;
  documentId: string;
  originalName: string;
  page: number;
  createdAt: string;
  updatedAt: string;
  archived: number;
};
export type BatchDraftFailure = {
  id: string;
  name: string;
  message: string;
};
export type BatchDraftResult = {
  saved: number;
  failed: BatchDraftFailure[];
};
export type InvoiceDeleteResult = {
  warnings: string[];
};
export type Filter = {
  search?: string;
  month?: string;
  category?: string;
  attribution?: string | null;
  archived?: boolean;
  page?: number;
};
export type AmountTotals = {
  amountCents: number;
  totalCents: number;
  taxCents: number;
};
export type StatsDateBasis = "invoiceDate" | "createdAt";
export type Stats = AmountTotals & {
  count: number;
  draftCount: number;
  duplicates: number;
  categories: (AmountTotals & { category: string; count: number })[];
  months: (AmountTotals & { month: string; count: number })[];
  sellers: (AmountTotals & { sellerName: string; count: number })[];
  attributions: (AmountTotals & { attribution: string; count: number })[];
};
export type AppInfo = {
  version: string;
  dataDir: string;
  engine: boolean;
  categories: string[];
  lastBackup: string | null;
};
export type ImportProgress = {
  current: number;
  total: number;
  filename: string;
  stage: string;
};
export type ConfirmationRequest = {
  id: string;
  title: string;
  description: string;
  details?: string;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
};
export type UpdateStatus =
  | "disabled"
  | "idle"
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "installing"
  | "error";
export type UpdateState = {
  status: UpdateStatus;
  version?: string;
  releaseNotes?: string;
  checkedAt?: string;
  percent?: number;
  message?: string;
};
export interface LedgerAPI {
  updateState(): Promise<UpdateState>;
  checkForUpdates(): Promise<UpdateState>;
  downloadUpdate(): Promise<UpdateState>;
  installUpdate(): Promise<void>;
  openReleases(): Promise<void>;
  onUpdate(callback: (state: UpdateState) => void): () => void;
  info(): Promise<AppInfo>;
  chooseFiles(): Promise<string[]>;
  pathsForFiles(files: File[]): string[];
  importFiles(paths: string[]): Promise<{ count: number; errors: string[] }>;
  cancelImport(): Promise<void>;
  onProgress(callback: (data: ImportProgress) => void): () => void;
  onConfirm(callback: (data: ConfirmationRequest) => void): () => void;
  respondConfirm(id: string, confirmed: boolean): Promise<void>;
  onNotice(callback: (message: string) => void): () => void;
  drafts(): Promise<Draft[]>;
  discardDraft(id: string): Promise<void>;
  verifyDrafts(ids: string[], attribution: string): Promise<BatchDraftResult>;
  saveDraft(
    id: string,
    fields: Fields,
  ): Promise<{ id?: string; duplicate?: Duplicate }>;
  checkDuplicate(number: string, code: string): Promise<Duplicate | null>;
  list(filter: Filter): Promise<{
    items: Invoice[];
    total: number;
    totals: AmountTotals;
  }>;
  getInvoice(id: string): Promise<Invoice | null>;
  updateInvoice(
    id: string,
    fields: Fields,
  ): Promise<{ id?: string; duplicate?: Duplicate }>;
  permanentlyDeleteInvoice(id: string): Promise<InvoiceDeleteResult>;
  archiveInvoice(id: string, archived: boolean): Promise<void>;
  stats(month?: string, dateBasis?: StatsDateBasis): Promise<Stats>;
  preview(kind: "draft" | "invoice", id: string): Promise<string | null>;
  openOriginal(kind: "draft" | "invoice", id: string): Promise<void>;
  exportExcel(filter: Filter): Promise<string | null>;
  backup(): Promise<string | null>;
  restore(): Promise<boolean>;
  openDataDir(): Promise<void>;
}
declare global {
  interface Window {
    ledger: LedgerAPI;
  }
}
