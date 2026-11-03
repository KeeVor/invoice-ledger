import { createReadStream, createWriteStream } from "node:fs";
import fs from "node:fs/promises";
import { join, resolve, relative, isAbsolute, dirname } from "node:path";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";
import { ZipFile } from "yazl";
import yauzl from "yauzl";
import Database from "better-sqlite3";
import { SCHEMA_VERSION, type LedgerDB } from "./database";

export function within(root: string, path: string) {
  const resolved = resolve(root, path),
    rel = relative(resolve(root), resolved);
  if (!rel || rel.startsWith("..") || isAbsolute(rel))
    throw new Error("非法的数据文件路径");
  return resolved;
}
async function addTree(zip: ZipFile, root: string, folder: string) {
  const full = within(root, folder);
  for (const entry of await fs.readdir(full, { withFileTypes: true })) {
    const child = `${folder}/${entry.name}`;
    if (entry.isSymbolicLink()) throw new Error("数据目录不能包含符号链接");
    if (entry.isDirectory()) await addTree(zip, root, child);
    else if (entry.isFile())
      zip.addFile(within(root, child), child, { compress: false });
  }
}
export async function createBackup(db: LedgerDB, root: string, target: string) {
  const snapshot = within(root, `.snapshot-${randomUUID()}.db`);
  const verification = within(root, `.backup-check-${randomUUID()}`);
  const partial = `${target}.partial`;
  try {
    await db.db.backup(snapshot);
    const zip = new ZipFile();
    zip.addBuffer(
      Buffer.from(
        JSON.stringify({
          application: "piaoji",
          version: 1,
          createdAt: new Date().toISOString(),
        }),
      ),
      "manifest.json",
    );
    zip.addFile(snapshot, "invoices.db");
    await addTree(zip, root, "originals");
    await addTree(zip, root, "previews");
    const done = pipeline(zip.outputStream, createWriteStream(partial));
    zip.end();
    await done;
    await unpackBackup(partial, verification);
    await fs.rename(partial, target);
  } finally {
    await fs.rm(snapshot, { force: true });
    await fs.rm(partial, { force: true }).catch(() => {});
    await fs.rm(verification, { recursive: true, force: true });
  }
}
export async function createAutoBackup(db: LedgerDB, root: string) {
  const folder = within(root, "backups");
  await fs.mkdir(folder, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const target = join(folder, `auto-${stamp}-${randomUUID()}.piaoji`);
  await createBackup(db, root, target);
  // Retire legacy managed backups only after the new backup passes validation.
  for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
    if (
      !entry.isFile() ||
      !/^(auto|before-update|before-restore)-.*\.piaoji$/.test(entry.name)
    )
      continue;
    const previous = within(root, `backups/${entry.name}`);
    if (previous !== target) await fs.rm(previous);
  }
  return target;
}
export async function unpackBackup(source: string, destination: string) {
  await fs.mkdir(destination, { recursive: true });
  const zip = await new Promise<yauzl.ZipFile>((res, rej) =>
    yauzl.open(
      source,
      { lazyEntries: true, validateEntrySizes: true },
      (error, file) => (error ? rej(error) : res(file!)),
    ),
  );
  let size = 0,
    count = 0;
  await new Promise<void>((resolvePromise, reject) => {
    const fail = (error: unknown) => {
      zip.close();
      reject(error);
    };
    zip.on("error", fail);
    zip.on("end", resolvePromise);
    zip.on("entry", (entry: yauzl.Entry) => {
      (async () => {
        if (
          ++count > 200000 ||
          (size += entry.uncompressedSize) > 20_000_000_000
        )
          throw new Error("备份超过安全解压限制");
        if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
          throw new Error("备份不能包含符号链接");
        const name = entry.fileName.replace(/\\/g, "/");
        if (
          name.includes(":") ||
          !(
            name === "manifest.json" ||
            name === "invoices.db" ||
            name.startsWith("originals/") ||
            name.startsWith("previews/")
          )
        )
          throw new Error("备份含有不支持的文件");
        const target = within(destination, name);
        if (name.endsWith("/")) {
          await fs.mkdir(target, { recursive: true });
          zip.readEntry();
          return;
        }
        await fs.mkdir(dirname(target), { recursive: true });
        const stream = await new Promise<NodeJS.ReadableStream>((res, rej) =>
          zip.openReadStream(entry, (err, s) => (err ? rej(err) : res(s!))),
        );
        await pipeline(stream, createWriteStream(target, { flags: "wx" }));
        zip.readEntry();
      })().catch(fail);
    });
    zip.readEntry();
  });
  const manifest = JSON.parse(
    await fs.readFile(join(destination, "manifest.json"), "utf8"),
  );
  if (manifest.application !== "piaoji" || manifest.version !== 1)
    throw new Error("不是本版本支持的票迹备份");
  const check = new Database(join(destination, "invoices.db"), {
    readonly: true,
    fileMustExist: true,
  });
  try {
    if (
      check.pragma("integrity_check", { simple: true }) !== "ok" ||
      ![1, SCHEMA_VERSION].includes(
        check.pragma("user_version", { simple: true }) as number,
      )
    )
      throw new Error("备份数据库校验失败");
    if ((check.pragma("foreign_key_check") as any[]).length)
      throw new Error("备份数据库关联记录不完整");
    for (const table of [
      "documents",
      "drafts",
      "invoices",
      "events",
      "settings",
    ])
      check.prepare(`SELECT * FROM ${table} LIMIT 1`).get();
    const paths = check
      .prepare(
        "SELECT storedPath AS path FROM documents UNION SELECT previewPath FROM drafts UNION SELECT previewPath FROM invoices",
      )
      .all() as { path: string }[];
    for (const row of paths) {
      if (!/^(originals|previews)[/\\]/.test(row.path))
        throw new Error("备份中的原件路径无效");
      const file = await fs.stat(within(destination, row.path));
      if (!file.isFile()) throw new Error("备份缺少原件或预览");
    }
  } finally {
    check.close();
  }
  await fs.mkdir(join(destination, "originals"), { recursive: true });
  await fs.mkdir(join(destination, "previews"), { recursive: true });
}
