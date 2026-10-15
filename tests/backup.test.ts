import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { LedgerDB } from "../electron/database";
import { createBackup, unpackBackup, within } from "../electron/backup";

test("full backup round trip retains originals and drafts", async () => {
  const root = resolve(".test-data", randomUUID());
  await fs.mkdir(join(root, "originals"), { recursive: true });
  await fs.mkdir(join(root, "previews"));
  const db = new LedgerDB(join(root, "invoices.db"));
  try {
    const id = randomUUID();
    await fs.writeFile(join(root, "originals", "one.pdf"), "sample");
    await fs.writeFile(join(root, "previews", "one.png"), "preview");
    db.addDocument({
      id,
      originalName: "原始文件.pdf",
      storedPath: "originals/one.pdf",
      sha256: "hash",
    });
    db.addDraft(id, 1, "previews/one.png", {
      invoiceNumber: "20000000000000000001",
      invoiceCode: "",
    });
    await createBackup(db, root, join(root, "test.piaoji"));
    const dest = join(root, "restore");
    await unpackBackup(join(root, "test.piaoji"), dest);
    assert.equal(
      await fs.readFile(join(dest, "originals", "one.pdf"), "utf8"),
      "sample",
    );
    const restored = new LedgerDB(join(dest, "invoices.db"));
    try {
      assert.equal(restored.drafts()[0].invoiceNumber, "20000000000000000001");
    } finally {
      restored.close();
    }
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});
test("path traversal and absolute paths are rejected", () => {
  const root = resolve(".test-data");
  assert.throws(() => within(root, "../evil"));
  assert.throws(() => within(root, root));
  assert.throws(() => within(root, "C:\\Windows\\evil"));
  assert.equal(
    within(root, "originals/good.pdf"),
    join(root, "originals", "good.pdf"),
  );
});
test("backup validation rejects unsupported files", async () => {
  const root = resolve(".test-data", randomUUID());
  await fs.mkdir(root, { recursive: true });
  try {
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from("malicious"), "unexpected.exe");
    const done = pipeline(
      zip.outputStream,
      createWriteStream(join(root, "bad.piaoji")),
    );
    zip.end();
    await done;
    await assert.rejects(
      unpackBackup(join(root, "bad.piaoji"), join(root, "out")),
      /不支持/,
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});
