import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import { resolve } from "node:path";
import Database from "better-sqlite3";
import { LedgerDB, validateFields } from "../electron/database";
import type { Fields } from "../src/types";

const fields: Fields = {
  invoiceNumber: "20000000000000000001",
  invoiceCode: "",
  invoiceDate: "2026-09-07",
  invoiceType: "增值税专用发票",
  buyerName: "购买方",
  sellerName: "销售方",
  buyerTaxId: "",
  sellerTaxId: "",
  itemName: "物业管理费",
  category: "物业费",
  attribution: "测试归属",
  amountCents: 1227310,
  taxCents: 73639,
  totalCents: 1300949,
  notes: "",
};
function fixture() {
  const db = new LedgerDB(":memory:");
  const documentId = randomUUID();
  db.addDocument({
    id: documentId,
    originalName: "sample.pdf",
    storedPath: "originals/test.pdf",
    sha256: "test",
  });
  return {
    db,
    add: (f: Fields = fields) =>
      db.addDraft(documentId, 1, "previews/test.png", f),
  };
}

test("20-digit identity is preserved as text and duplicate imports cannot save", () => {
  const { db, add } = fixture();
  try {
    const a = db.saveDraft(add(), fields);
    assert.ok(a.id);
    const b = db.saveDraft(add(), fields);
    assert.equal(b.duplicate?.id, a.id);
    assert.equal(db.list({}).total, 1);
    assert.equal(db.getInvoice(a.id!)?.invoiceNumber, fields.invoiceNumber);
    assert.equal(db.stats().totalCents, 1300949);
    assert.equal(db.drafts().length, 1);
  } finally {
    db.close();
  }
});
test("legacy identity uses code AND number", () => {
  const { db, add } = fixture();
  try {
    const a = {
      ...fields,
      invoiceNumber: "12345678",
      invoiceCode: "123456789012",
    };
    const b = { ...a, invoiceCode: "987654321098" };
    assert.ok(db.saveDraft(add(a), a).id);
    assert.ok(db.saveDraft(add(b), b).id);
    assert.ok(db.saveDraft(add(a), a).duplicate);
    assert.equal(db.stats().count, 2);
  } finally {
    db.close();
  }
});
test("digital identity ignores irrelevant legacy code", () => {
  const { db, add } = fixture();
  try {
    db.saveDraft(add(), fields);
    assert.ok(
      db.saveDraft(add(), { ...fields, invoiceCode: "123456789012" }).duplicate,
    );
  } finally {
    db.close();
  }
});
test("batch verification applies attribution and reports per-invoice failures", () => {
  const { db, add } = fixture();
  try {
    const existing = db.saveDraft(add(), fields).id!;
    const valid = add({
      ...fields,
      invoiceNumber: "20000000000000000002",
    });
    const duplicate = add(fields);
    const invalid = add({
      ...fields,
      invoiceNumber: "20000000000000000003",
      totalCents: 1,
    });
    const result = db.verifyDrafts(
      [valid, duplicate, invalid, valid],
      "  新批次  ",
    );
    assert.equal(result.saved, 1);
    assert.equal(result.failed.length, 2);
    assert.match(result.failed[0].message, /已在台账中/);
    assert.match(result.failed[1].message, /价税合计/);
    assert.equal(db.drafts().length, 2);
    const saved = db.list({ attribution: "新批次" }).items[0];
    assert.equal(saved.attribution, "新批次");
    assert.equal(saved.id === existing, false);
    assert.deepEqual(
      db
        .stats()
        .attributions.map(({ attribution, count, totalCents }) => ({
          attribution,
          count,
          totalCents,
        }))
        .sort((a, b) => a.attribution.localeCompare(b.attribution)),
      [
        { attribution: "测试归属", count: 1, totalCents: 1300949 },
        { attribution: "新批次", count: 1, totalCents: 1300949 },
      ],
    );
    assert.equal(db.list({ attribution: null }).total, 0);
  } finally {
    db.close();
  }
});
test("version 1 databases gain an empty attribution column without data loss", async () => {
  const path = resolve(".test-data", `${randomUUID()}.db`);
  let db = new LedgerDB(path);
  try {
    const documentId = randomUUID();
    db.addDocument({
      id: documentId,
      originalName: "legacy.pdf",
      storedPath: "originals/legacy.pdf",
      sha256: "legacy",
    });
    db.saveDraft(
      db.addDraft(documentId, 1, "previews/legacy.png", {
        ...fields,
        attribution: "",
      }),
      { ...fields, attribution: "" },
    );
    db.close();
    const legacy = new Database(path);
    legacy.exec(
      "ALTER TABLE invoices DROP COLUMN attribution; PRAGMA user_version = 1;",
    );
    legacy.close();
    db = new LedgerDB(path);
    assert.equal(db.db.pragma("user_version", { simple: true }), 2);
    assert.equal(db.list({}).items[0].attribution, "");
    assert.equal(db.list({ attribution: null }).total, 1);
  } finally {
    try {
      db.close();
    } catch {}
    for (const suffix of ["", "-wal", "-shm"])
      await fs.rm(`${path}${suffix}`, { force: true });
  }
});
test("archived invoice remains duplicate and can be restored", () => {
  const { db, add } = fixture();
  try {
    const { id } = db.saveDraft(add(), fields);
    db.archiveInvoice(id!, true);
    assert.equal(db.stats().count, 0);
    assert.equal(db.list({ archived: true }).total, 1);
    assert.equal(db.duplicate(fields.invoiceNumber, "")?.archived, 1);
    db.archiveInvoice(id!, false);
    assert.equal(db.stats().count, 1);
  } finally {
    db.close();
  }
});
test("invalid dates, incomplete legacy identifiers and unbalanced or imprecise money fail", () => {
  for (const patch of [
    { invoiceDate: "2026-02-30" },
    { invoiceNumber: "12345678" },
    { totalCents: 1 },
    { taxCents: 0.1 },
    { invoiceNumber: "2000000000000000000O" },
    { totalCents: null },
  ])
    assert.throws(() => validateFields({ ...fields, ...patch }));
  assert.equal(
    validateFields({ ...fields, invoiceNumber: " 20000000000000000001 " })
      .invoiceNumber,
    fields.invoiceNumber,
  );
});
test("red invoices use signed cents in statistics", () => {
  const { db, add } = fixture();
  try {
    const red = {
      ...fields,
      amountCents: -1227310,
      taxCents: -73639,
      totalCents: -1300949,
    };
    db.saveDraft(add(red), red);
    assert.equal(db.stats().totalCents, -1300949);
  } finally {
    db.close();
  }
});
test("updates are checked for identity collisions and logged", () => {
  const { db, add } = fixture();
  try {
    const a = db.saveDraft(add(), fields);
    const f2 = { ...fields, invoiceNumber: "20000000000000000002" };
    const b = db.saveDraft(add(f2), f2);
    assert.equal(db.updateInvoice(b.id!, fields).duplicate?.id, a.id);
    assert.equal(db.getInvoice(b.id!)?.invoiceNumber, f2.invoiceNumber);
    db.updateInvoice(a.id!, { ...fields, notes: "changed" });
    assert.equal(db.getInvoice(a.id!)?.notes, "changed");
    assert.equal(
      (
        db.db
          .prepare("SELECT COUNT(*) n FROM events WHERE kind='update'")
          .get() as any
      ).n,
      1,
    );
  } finally {
    db.close();
  }
});
test("filters use literal LIKE search and separate month/category", () => {
  const { db, add } = fixture();
  try {
    db.saveDraft(add(), fields);
    assert.equal(db.list({ search: "%" }).total, 0);
    assert.equal(db.list({ search: "' OR 1=1--" }).total, 0);
    assert.equal(db.list({ search: "200000" }).total, 1);
    assert.equal(db.list({ month: "2026-08" }).total, 0);
    assert.equal(db.list({ category: "物业费" }).total, 1);
    assert.equal(db.stats("2026-08").totalCents, 0);
  } finally {
    db.close();
  }
});
test("draft removal cannot delete confirmed invoices", () => {
  const { db, add } = fixture();
  try {
    const a = db.saveDraft(add(), fields);
    const draft = add();
    db.discardDraft(draft);
    assert.equal(db.drafts().length, 0);
    assert.ok(db.getInvoice(a.id!));
  } finally {
    db.close();
  }
});

test("ledger amount totals cover every filtered page, excluding drafts and archived records", () => {
  const { db, add } = fixture();
  const amounts = { amountCents: 101, taxCents: 6, totalCents: 107 };
  try {
    for (let i = 0; i < 51; i++) {
      const f = {
        ...fields,
        ...amounts,
        invoiceNumber: String(10000000000000000000n + BigInt(i)),
      };
      db.saveDraft(add(f), f);
    }
    const other = {
      ...fields,
      invoiceNumber: "20000000000000000000",
      invoiceDate: "2026-10-01",
      category: "其他",
      notes: "special%",
      amountCents: -100,
      taxCents: 0,
      totalCents: -100,
    };
    db.saveDraft(add(other), other);
    const archived = { ...fields, invoiceNumber: "30000000000000000000" };
    db.archiveInvoice(db.saveDraft(add(archived), archived).id!, true);
    add();
    const expected = { amountCents: 5051, taxCents: 306, totalCents: 5357 };
    assert.equal(db.list({}).items.length, 50);
    assert.equal(db.list({ page: 2 }).items.length, 2);
    assert.deepEqual(db.list({}).totals, expected);
    assert.deepEqual(db.list({ page: 2 }).totals, expected);
    assert.deepEqual(
      db.list({ month: "2026-10", category: "其他", search: "%" }).totals,
      {
        amountCents: -100,
        taxCents: 0,
        totalCents: -100,
      },
    );
    assert.deepEqual(db.list({ month: "2026-09", category: "物业费" }).totals, {
      amountCents: 5151,
      taxCents: 306,
      totalCents: 5457,
    });
    assert.deepEqual(db.list({ search: "not-found" }).totals, {
      amountCents: 0,
      taxCents: 0,
      totalCents: 0,
    });
    assert.equal(db.stats().amountCents, expected.amountCents);
    assert.equal(db.stats().taxCents, expected.taxCents);
  } finally {
    db.close();
  }
});

test("entry timestamp is assigned on confirmation and survives edits and archive changes", () => {
  const { db, add } = fixture();
  try {
    const draft = add();
    db.db
      .prepare("UPDATE drafts SET createdAt=? WHERE id=?")
      .run("2020-01-01T00:00:00.000Z", draft);
    const before = Date.now();
    const { id } = db.saveDraft(draft, {
      ...fields,
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    const saved = db.getInvoice(id!)!;
    assert.ok(
      Date.parse(saved.createdAt) >= before &&
        Date.parse(saved.createdAt) <= Date.now(),
    );
    db.updateInvoice(id!, {
      ...fields,
      notes: "edited",
      createdAt: "2000-01-01T00:00:00.000Z",
    });
    db.archiveInvoice(id!, true);
    db.archiveInvoice(id!, false);
    assert.equal(db.getInvoice(id!)!.createdAt, saved.createdAt);
  } finally {
    db.close();
  }
});

test("entry-time statistics use the local month consistently across totals, categories, sellers and months", () => {
  const { db, add } = fixture();
  try {
    const first = db.saveDraft(add(), fields).id!;
    const red = {
      ...fields,
      invoiceNumber: "20000000000000000002",
      category: "其他",
      sellerName: "另一销售方",
      amountCents: -100,
      taxCents: -6,
      totalCents: -106,
    };
    const second = db.saveDraft(add(red), red).id!;
    const excluded = { ...fields, invoiceNumber: "20000000000000000003" };
    const archived = db.saveDraft(add(excluded), excluded).id!;
    db.archiveInvoice(archived, true);
    add();
    // Cover both an ordinary month boundary and a year boundary in the host timezone.
    for (const [year, month] of [
      [2026, 9],
      [2027, 0],
    ]) {
      const boundary = new Date(year, month, 1);
      const previous = new Date(boundary.getTime() - 1);
      const key = (d: Date) =>
        `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
      db.db
        .prepare("UPDATE invoices SET createdAt=? WHERE id IN (?,?)")
        .run(boundary.toISOString(), first, archived);
      db.db
        .prepare("UPDATE invoices SET createdAt=? WHERE id=?")
        .run(previous.toISOString(), second);
      const report = db.stats(key(boundary), "createdAt");
      assert.equal(report.count, 1);
      assert.equal(report.amountCents, fields.amountCents);
      assert.equal(report.taxCents, fields.taxCents);
      assert.equal(report.totalCents, fields.totalCents);
      assert.deepEqual(report.categories, [
        {
          category: fields.category,
          count: 1,
          amountCents: fields.amountCents,
          taxCents: fields.taxCents,
          totalCents: fields.totalCents,
        },
      ]);
      assert.equal(report.sellers[0].sellerName, fields.sellerName);
      assert.equal(report.sellers[0].amountCents, fields.amountCents);
      assert.deepEqual(
        report.months.map((r) => [r.month, r.count, r.taxCents]),
        [
          [key(boundary), 1, fields.taxCents],
          [key(previous), 1, -6],
        ],
      );
      assert.equal(db.stats(key(previous), "createdAt").totalCents, -106);
      assert.equal(db.stats("2026-09", "invoiceDate").count, 2);
      assert.equal(db.stats("2026-09").count, 2);
    }
    const empty = db.stats("2000-01", "createdAt");
    assert.equal(empty.amountCents, 0);
    assert.equal(empty.taxCents, 0);
    assert.equal(empty.totalCents, 0);
    assert.deepEqual(empty.categories, []);
    assert.deepEqual(empty.sellers, []);
    assert.equal(
      empty.months.length,
      2,
      "Monthly history is independent of selected month",
    );
    assert.equal(db.stats("", "createdAt").count, 2);
  } finally {
    db.close();
  }
});
