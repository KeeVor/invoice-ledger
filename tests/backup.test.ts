import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { LedgerDB } from "../electron/database";
import {
  createAutoBackup,
  createBackup,
  unpackBackup,
  within,
} from "../electron/backup";

async function withLedger(run: (root: string, db: LedgerDB) => Promise<void>) {
  const root = within(resolve(".test-data"), randomUUID());
  await fs.mkdir(join(root, "originals"), { recursive: true });
  await fs.mkdir(join(root, "previews"));
  const db = new LedgerDB(join(root, "invoices.db"));
  try {
    await run(root, db);
  } finally {
    db.close();
    await fs.rm(root, { recursive: true, force: true });
  }
}

async function assertNoTemporaryFiles(root: string) {
  assert.equal(
    (await fs.readdir(root)).some((name) => /^(\.snapshot-|\.backup-check-)/.test(name)),
    false,
  );
  assert.equal(
    (await fs.readdir(join(root, "backups"))).some((name) => name.endsWith(".partial")),
    false,
  );
}

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

test("automatic backups keep one validated copy and retire legacy managed backups only", async () => {
  await withLedger(async (root, db) => {
    db.setSetting("backup-marker", "old");
    const old = await createAutoBackup(db, root);
    const folder = join(root, "backups");
    const manual = join(folder, "manual-export.piaoji");
    for (const name of [
      "auto-older.piaoji",
      "before-update-old.piaoji",
      "before-restore-old.piaoji",
      "manual-export.piaoji",
    ])
      await fs.copyFile(old, join(folder, name));
    const manualBytes = await fs.readFile(manual);
    await fs.writeFile(join(folder, "notes.txt"), "keep");
    db.setSetting("backup-marker", "new");
    const current = await createAutoBackup(db, root);
    assert.notEqual(current, old);
    assert.deepEqual(
      (await fs.readdir(folder)).sort(),
      [basename(current), "manual-export.piaoji", "notes.txt"].sort(),
    );
    assert.deepEqual(await fs.readFile(manual), manualBytes);
    const dest = join(root, "restored");
    await unpackBackup(current, dest);
    const restored = new LedgerDB(join(dest, "invoices.db"));
    try {
      assert.equal(restored.setting("backup-marker"), "new");
    } finally {
      restored.close();
    }
    await assertNoTemporaryFiles(root);
  });
});

test("failed backup validation preserves every previous managed backup", async () => {
  await withLedger(async (root, db) => {
    const old = await createAutoBackup(db, root);
    const folder = join(root, "backups");
    await fs.copyFile(old, join(folder, "before-update-old.piaoji"));
    const oldBytes = await fs.readFile(old);
    const previous = (await fs.readdir(folder)).sort();
    db.addDocument({
      id: randomUUID(),
      originalName: "missing.pdf",
      storedPath: "originals/missing.pdf",
      sha256: "hash",
    });
    await assert.rejects(createAutoBackup(db, root), /ENOENT/);
    assert.deepEqual((await fs.readdir(folder)).sort(), previous);
    assert.deepEqual(await fs.readFile(old), oldBytes);
    await unpackBackup(old, join(root, "restored"));
    await assertNoTemporaryFiles(root);
  });
});

test("invalid snapshot database cannot replace the last automatic backup", async () => {
  await withLedger(async (root, db) => {
    const old = await createAutoBackup(db, root);
    const oldBytes = await fs.readFile(old);
    db.db.pragma("user_version = 2");
    await assert.rejects(createAutoBackup(db, root), /备份数据库校验失败/);
    assert.deepEqual(await fs.readdir(join(root, "backups")), [basename(old)]);
    assert.deepEqual(await fs.readFile(old), oldBytes);
    await assertNoTemporaryFiles(root);
  });
});

test("failed validation does not overwrite an existing manual export", async () => {
  await withLedger(async (root, db) => {
    await fs.mkdir(join(root, "backups"));
    const target = join(root, "manual.piaoji");
    await createBackup(db, root, target);
    const original = await fs.readFile(target);
    db.addDocument({
      id: randomUUID(),
      originalName: "missing.pdf",
      storedPath: "originals/missing.pdf",
      sha256: "hash",
    });
    await assert.rejects(createBackup(db, root, target), /ENOENT/);
    assert.deepEqual(await fs.readFile(target), original);
    await assert.rejects(fs.stat(`${target}.partial`), /ENOENT/);
    await assertNoTemporaryFiles(root);
  });
});
