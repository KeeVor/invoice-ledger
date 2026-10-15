import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  Fields,
  Filter,
  Invoice,
  Draft,
  Duplicate,
  Stats,
  StatsDateBasis,
  AmountTotals,
} from "../src/types";

export const CATEGORIES = [
  "未分类",
  "物业费",
  "食品 / 农产品",
  "办公用品",
  "餐饮费",
  "交通出行",
  "住宿费",
  "水电能源",
  "技术服务",
  "设备 / 材料",
  "多类目 / 待拆分",
  "其他",
];
const text = (max: number) => z.string().trim().max(max);
export const fieldsSchema = z
  .object({
    invoiceNumber: text(30)
      .transform((v) => v.replace(/\s/g, ""))
      .refine(
        (v) => /^(\d{20}|\d{8})$/.test(v),
        "发票号码须为 20 位，或旧版发票的 8 位数字",
      ),
    invoiceCode: text(20)
      .transform((v) => v.replace(/\s/g, ""))
      .refine(
        (v) => v === "" || /^\d{10,12}$/.test(v),
        "发票代码须为 10 至 12 位数字",
      ),
    invoiceDate: text(10).refine(
      (v) =>
        /^\d{4}-\d{2}-\d{2}$/.test(v) &&
        !Number.isNaN(Date.parse(v)) &&
        new Date(v).toISOString().slice(0, 10) === v,
      "请填写有效的开票日期",
    ),
    invoiceType: text(100),
    buyerName: text(300),
    sellerName: text(300),
    buyerTaxId: text(30),
    sellerTaxId: text(30),
    itemName: text(1000),
    category: text(100).min(1, "请选择分类"),
    notes: text(4000),
    amountCents: z.number().int().min(-1e14).max(1e14),
    taxCents: z.number().int().min(-1e14).max(1e14),
    totalCents: z.number().int().min(-1e14).max(1e14),
  })
  .superRefine((v, ctx) => {
    if (v.invoiceNumber.length === 8 && !v.invoiceCode)
      ctx.addIssue({
        code: "custom",
        message: "8 位发票号码必须同时填写发票代码",
        path: ["invoiceCode"],
      });
    if (v.amountCents + v.taxCents !== v.totalCents)
      ctx.addIssue({
        code: "custom",
        message: "不含税金额 + 税额必须等于价税合计",
        path: ["totalCents"],
      });
  });
export function validateFields(input: unknown): Fields {
  const r = fieldsSchema.safeParse(input);
  if (!r.success)
    throw new Error(r.error.issues.map((i) => i.message).join("；"));
  return r.data;
}
export function identity(number: string, code: string) {
  return number.length === 20
    ? `digital:${number}`
    : `legacy:${code}:${number}`;
}
export const filterSchema = z.object({
  search: text(200).optional(),
  month: z
    .string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
    .or(z.literal(""))
    .optional(),
  category: text(100).optional(),
  archived: z.boolean().optional(),
  page: z.number().int().min(1).max(100000).optional(),
});
const columns = [
  "invoiceNumber",
  "invoiceCode",
  "invoiceDate",
  "invoiceType",
  "buyerName",
  "sellerName",
  "buyerTaxId",
  "sellerTaxId",
  "itemName",
  "category",
  "amountCents",
  "taxCents",
  "totalCents",
  "notes",
];

export class LedgerDB {
  db: Database.Database;
  constructor(public path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    const version = this.db.pragma("user_version", { simple: true }) as number;
    if (version > 1) {
      this.db.close();
      throw new Error("数据库来自更新版本，请升级软件后打开");
    }
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, originalName TEXT NOT NULL, storedPath TEXT NOT NULL, sha256 TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS idx_document_hash ON documents(sha256);
      CREATE TABLE IF NOT EXISTS drafts (id TEXT PRIMARY KEY, documentId TEXT NOT NULL REFERENCES documents(id), page INTEGER NOT NULL, previewPath TEXT NOT NULL, payload TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY, identity TEXT NOT NULL UNIQUE, documentId TEXT NOT NULL REFERENCES documents(id), page INTEGER NOT NULL, previewPath TEXT NOT NULL,
        invoiceNumber TEXT NOT NULL, invoiceCode TEXT NOT NULL, invoiceDate TEXT NOT NULL, invoiceType TEXT NOT NULL,
        buyerName TEXT NOT NULL, sellerName TEXT NOT NULL, buyerTaxId TEXT NOT NULL, sellerTaxId TEXT NOT NULL,
        itemName TEXT NOT NULL, category TEXT NOT NULL, amountCents INTEGER NOT NULL, taxCents INTEGER NOT NULL, totalCents INTEGER NOT NULL,
        notes TEXT NOT NULL, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, archived INTEGER NOT NULL DEFAULT 0,
        CHECK(amountCents + taxCents = totalCents)
      );
      CREATE INDEX IF NOT EXISTS idx_invoice_date ON invoices(invoiceDate);
      CREATE INDEX IF NOT EXISTS idx_invoice_category ON invoices(category);
      CREATE TABLE IF NOT EXISTS events (id TEXT PRIMARY KEY, kind TEXT NOT NULL, target TEXT NOT NULL, detail TEXT NOT NULL, createdAt TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      PRAGMA user_version = 1;
    `);
  }
  close() {
    this.db.close();
  }
  event(kind: string, target: string, detail = "") {
    this.db
      .prepare("INSERT INTO events VALUES (?,?,?,?,?)")
      .run(randomUUID(), kind, target, detail, new Date().toISOString());
  }
  setting(key: string) {
    return (
      (
        this.db.prepare("SELECT value FROM settings WHERE key=?").get(key) as
          | { value: string }
          | undefined
      )?.value ?? null
    );
  }
  setSetting(key: string, value: string) {
    this.db
      .prepare(
        "INSERT INTO settings VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      )
      .run(key, value);
  }
  document(id: string) {
    return this.db.prepare("SELECT * FROM documents WHERE id=?").get(id) as
      | { id: string; originalName: string; storedPath: string; sha256: string }
      | undefined;
  }
  addDocument(doc: {
    id: string;
    originalName: string;
    storedPath: string;
    sha256: string;
  }) {
    this.db
      .prepare(
        "INSERT INTO documents VALUES (@id,@originalName,@storedPath,@sha256,@createdAt)",
      )
      .run({ ...doc, createdAt: new Date().toISOString() });
  }
  addDraft(
    documentId: string,
    page: number,
    previewPath: string,
    fields: object,
  ) {
    const id = randomUUID();
    this.db
      .prepare("INSERT INTO drafts VALUES (?,?,?,?,?,?)")
      .run(
        id,
        documentId,
        page,
        previewPath,
        JSON.stringify(fields),
        new Date().toISOString(),
      );
    return id;
  }
  drafts(): Draft[] {
    const rows = this.db
      .prepare(
        "SELECT d.*, o.originalName FROM drafts d JOIN documents o ON o.id=d.documentId ORDER BY d.createdAt, d.page",
      )
      .all() as any[];
    return rows.map(({ payload, previewPath: _, ...r }) => {
      const fields = JSON.parse(payload);
      return {
        ...fields,
        ...r,
        duplicate:
          this.duplicate(fields.invoiceNumber, fields.invoiceCode) ?? undefined,
      };
    });
  }
  discardDraft(id: string) {
    this.db.transaction(() => {
      this.db.prepare("DELETE FROM drafts WHERE id=?").run(id);
      this.event("discard-draft", id);
    })();
  }
  duplicate(number: string, code: string, exceptId = ""): Duplicate | null {
    if (!/^(\d{20}|\d{8})$/.test(number) || (number.length === 8 && !code))
      return null;
    return (
      (this.db
        .prepare(
          "SELECT id,invoiceNumber,createdAt,archived FROM invoices WHERE identity=? AND id<>?",
        )
        .get(identity(number, code), exceptId) as Duplicate | undefined) ?? null
    );
  }
  saveDraft(id: string, input: unknown) {
    const fields = validateFields(input);
    return this.db.transaction(() => {
      const draft = this.db
        .prepare("SELECT * FROM drafts WHERE id=?")
        .get(id) as any;
      if (!draft) throw new Error("待核对记录不存在，可能已保存或移除");
      const duplicate = this.duplicate(
        fields.invoiceNumber,
        fields.invoiceCode,
      );
      if (duplicate) {
        this.event("duplicate-save", id, duplicate.id);
        return { duplicate };
      }
      const invoiceId = randomUUID(),
        now = new Date().toISOString();
      this.db
        .prepare(
          `INSERT INTO invoices (id,identity,documentId,page,previewPath,${columns.join(",")},createdAt,updatedAt) VALUES (@id,@identity,@documentId,@page,@previewPath,${columns.map((c) => `@${c}`).join(",")},@createdAt,@updatedAt)`,
        )
        .run({
          ...fields,
          id: invoiceId,
          identity: identity(fields.invoiceNumber, fields.invoiceCode),
          documentId: draft.documentId,
          page: draft.page,
          previewPath: draft.previewPath,
          createdAt: now,
          updatedAt: now,
        });
      this.db.prepare("DELETE FROM drafts WHERE id=?").run(id);
      this.event("create", invoiceId, JSON.stringify(fields));
      return { id: invoiceId };
    })();
  }
  updateInvoice(id: string, input: unknown) {
    const fields = validateFields(input);
    return this.db.transaction(() => {
      const existing = this.getInvoice(id);
      if (!existing) throw new Error("记录不存在");
      const duplicate = this.duplicate(
        fields.invoiceNumber,
        fields.invoiceCode,
        id,
      );
      if (duplicate) return { duplicate };
      this.db
        .prepare(
          `UPDATE invoices SET ${columns.map((c) => `${c}=@${c}`).join(",")}, identity=@identity,updatedAt=@updatedAt WHERE id=@id`,
        )
        .run({
          ...fields,
          id,
          identity: identity(fields.invoiceNumber, fields.invoiceCode),
          updatedAt: new Date().toISOString(),
        });
      this.event(
        "update",
        id,
        JSON.stringify({ before: existing, after: fields }),
      );
      return { id };
    })();
  }
  archiveInvoice(id: string, archived: boolean) {
    this.db.transaction(() => {
      if (!this.getInvoice(id)) throw new Error("记录不存在");
      this.db
        .prepare("UPDATE invoices SET archived=?,updatedAt=? WHERE id=?")
        .run(Number(archived), new Date().toISOString(), id);
      this.event(archived ? "archive" : "unarchive", id);
    })();
  }
  getInvoice(id: string) {
    return (
      (this.db
        .prepare(
          "SELECT i.*,d.originalName FROM invoices i JOIN documents d ON d.id=i.documentId WHERE i.id=?",
        )
        .get(id) as Invoice | undefined) ?? null
    );
  }
  resource(kind: "draft" | "invoice", id: string) {
    return this.db
      .prepare(
        `SELECT r.previewPath,d.storedPath FROM ${kind === "draft" ? "drafts" : "invoices"} r JOIN documents d ON d.id=r.documentId WHERE r.id=?`,
      )
      .get(id) as { previewPath: string; storedPath: string } | undefined;
  }
  where(filter: Filter) {
    const clauses = ["i.archived=@archived"];
    const params: Record<string, string | number> = {
      archived: Number(filter.archived ?? false),
    };
    if (filter.month) {
      clauses.push("substr(i.invoiceDate,1,7)=@month");
      params.month = filter.month;
    }
    if (filter.category) {
      clauses.push("i.category=@category");
      params.category = filter.category;
    }
    if (filter.search) {
      clauses.push(
        "(i.invoiceNumber LIKE @search ESCAPE '\\' OR i.buyerName LIKE @search ESCAPE '\\' OR i.sellerName LIKE @search ESCAPE '\\' OR i.itemName LIKE @search ESCAPE '\\' OR i.notes LIKE @search ESCAPE '\\')",
      );
      params.search = `%${filter.search.replace(/[\\%_]/g, "\\$&")}%`;
    }
    return { sql: clauses.join(" AND "), params };
  }
  list(filter: Filter, all = false) {
    const { sql, params } = this.where(filter);
    const { count: total, ...totals } = this.db
      .prepare(
        `SELECT COUNT(*) AS count,COALESCE(SUM(amountCents),0) AS amountCents,COALESCE(SUM(taxCents),0) AS taxCents,COALESCE(SUM(totalCents),0) AS totalCents FROM invoices i WHERE ${sql}`,
      )
      .get(params) as AmountTotals & { count: number };
    const items = this.db
      .prepare(
        `SELECT i.*,d.originalName FROM invoices i JOIN documents d ON d.id=i.documentId WHERE ${sql} ORDER BY i.invoiceDate DESC,i.createdAt DESC ${all ? "" : "LIMIT 50 OFFSET @offset"}`,
      )
      .all(
        all ? params : { ...params, offset: ((filter.page ?? 1) - 1) * 50 },
      ) as Invoice[];
    return { items, total, totals };
  }
  stats(month = "", dateBasis: StatsDateBasis = "invoiceDate"): Stats {
    // Saved timestamps are UTC; reporting months match local time in the UI.
    const monthExpression =
      dateBasis === "createdAt"
        ? "strftime('%Y-%m',createdAt,'localtime')"
        : "substr(invoiceDate,1,7)";
    const where = `archived=0${month ? ` AND ${monthExpression}=@month` : ""}`;
    const params = month ? { month } : {};
    const sums =
      "COALESCE(SUM(amountCents),0) AS amountCents,COALESCE(SUM(taxCents),0) AS taxCents,COALESCE(SUM(totalCents),0) AS totalCents";
    const base = this.db
      .prepare(`SELECT COUNT(*) AS count,${sums} FROM invoices WHERE ${where}`)
      .get(params) as any;
    return {
      ...base,
      draftCount: (
        this.db.prepare("SELECT COUNT(*) AS n FROM drafts").get() as any
      ).n,
      duplicates: (
        this.db
          .prepare(
            "SELECT COUNT(*) AS n FROM events WHERE kind='duplicate-import'",
          )
          .get() as any
      ).n,
      categories: this.db
        .prepare(
          `SELECT category,COUNT(*) AS count,${sums} FROM invoices WHERE ${where} GROUP BY category ORDER BY totalCents DESC`,
        )
        .all(params) as any,
      sellers: this.db
        .prepare(
          `SELECT sellerName,COUNT(*) AS count,${sums} FROM invoices WHERE ${where} GROUP BY sellerName ORDER BY totalCents DESC LIMIT 10`,
        )
        .all(params) as any,
      months: this.db
        .prepare(
          `SELECT ${monthExpression} AS month,COUNT(*) AS count,${sums} FROM invoices WHERE archived=0 GROUP BY month ORDER BY month DESC LIMIT 12`,
        )
        .all() as any,
    };
  }
}
