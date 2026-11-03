import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import fs from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, basename, dirname, extname, relative, resolve } from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { z } from "zod";
import ExcelJS from "exceljs";
import { LedgerDB, CATEGORIES, filterSchema } from "./database";
import { OCRWorker } from "./ocr";
import { createAutoBackup, createBackup, unpackBackup, within } from "./backup";
import type { Filter, ImportProgress, ConfirmationRequest } from "../src/types";
import { userError } from "../src/messages";
import { autoUpdater } from "electron-updater";
import { UpdateService, RELEASES_URL } from "./updates";

const testDir = process.env.INVOICE_LEDGER_DATA_DIR;
if (testDir && !app.isPackaged) app.setPath("userData", resolve(testDir));
else app.setPath("userData", join(app.getPath("appData"), "Piaoji"));
const root = app.getPath("userData");
let win: BrowserWindow, db: LedgerDB, worker: OCRWorker;
let updates: UpdateService;
let updateInstalling = false;
let importing = false,
  cancelled = false,
  maintenance = false,
  dirty = false,
  closing = false;
const id = z.string().uuid();
const kind = z.enum(["draft", "invoice"]);
const monthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/)
  .or(z.literal(""));
const dateTag = () => new Date().toISOString().replace(/[:.]/g, "-");
let pendingConfirmation:
  | { id: string; resolve: (confirmed: boolean) => void }
  | undefined;

function confirmInWindow(
  request: Omit<ConfirmationRequest, "id">,
): Promise<boolean> {
  if (pendingConfirmation || win.isDestroyed() || win.webContents.isDestroyed())
    return Promise.resolve(false);
  return new Promise((resolveConfirmation) => {
    const requestId = randomUUID();
    const contents = win.webContents;
    // A renderer reload or crash cancels the action rather than accepting it.
    const cancel = () => finish(false);
    const finish = (confirmed: boolean) => {
      contents.removeListener("did-start-loading", cancel);
      contents.removeListener("render-process-gone", cancel);
      win.removeListener("closed", cancel);
      pendingConfirmation = undefined;
      resolveConfirmation(confirmed);
    };
    pendingConfirmation = { id: requestId, resolve: finish };
    contents.once("did-start-loading", cancel);
    contents.once("render-process-gone", cancel);
    win.once("closed", cancel);
    contents.send("ui-confirm", { ...request, id: requestId });
  });
}

function writable() {
  if (maintenance) throw new Error("正在备份或恢复，请稍后操作");
}
function handle(channel: string, callback: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (
      event.sender !== win.webContents ||
      event.senderFrame !== win.webContents.mainFrame
    )
      throw new Error("不允许的调用来源");
    try {
      return await callback(...args);
    } catch (error) {
      throw new Error(
        error instanceof z.ZodError
          ? "输入格式不正确，请检查后重试"
          : error instanceof Error
            ? userError(error)
            : "操作失败",
      );
    }
  });
}
async function importFiles(input: unknown) {
  writable();
  if (importing) throw new Error("已有导入任务，请等待或取消");
  const paths = z.array(z.string().max(32768)).min(1).max(500).parse(input);
  importing = true;
  cancelled = false;
  const errors: string[] = [];
  let count = 0;
  try {
    for (let i = 0; i < paths.length; i++) {
      if (cancelled) break;
      const file = resolve(paths[i]);
      const progress: ImportProgress = {
        current: i + 1,
        total: paths.length,
        filename: basename(file),
        stage: "正在识别发票",
      };
      win.webContents.send("import-progress", progress);
      try {
        const extension = extname(file).toLowerCase();
        if (
          ![
            ".pdf",
            ".png",
            ".jpg",
            ".jpeg",
            ".webp",
            ".bmp",
            ".tif",
            ".tiff",
          ].includes(extension)
        )
          throw new Error("仅支持 PDF、PNG、JPG、WEBP、BMP、TIFF");
        const stat = await fs.stat(file);
        if (!stat.isFile() || stat.size > 50 * 1024 * 1024 || !stat.size)
          throw new Error("文件为空或超过 50 MB");
        const documentId = randomUUID();
        const storedPath = `originals/${documentId}${extension}`;
        const original = within(root, storedPath);
        await fs.copyFile(file, original);
        const sha256 = createHash("sha256")
          .update(await fs.readFile(original))
          .digest("hex");
        db.addDocument({
          id: documentId,
          originalName: basename(file),
          storedPath,
          sha256,
        });
        dirty = true;
        if (cancelled) break;
        const results = await worker.run(
          original,
          within(root, `previews/${documentId}`),
        );
        if (cancelled) break;
        db.db.transaction(() => {
          for (const result of results) {
            const previewPath = relative(root, result.previewPath).replace(
              /\\/g,
              "/",
            );
            within(root, previewPath);
            const draftId = db.addDraft(
              documentId,
              result.page,
              previewPath,
              result,
            );
            const duplicate = db.duplicate(
              result.invoiceNumber,
              result.invoiceCode,
            );
            if (duplicate) db.event("duplicate-import", draftId, duplicate.id);
            count++;
          }
          db.event("import", documentId, `${results.length} page(s)`);
        })();
        dirty = true;
      } catch (error) {
        if (!cancelled)
          errors.push(
            `${basename(file)}：${userError(error, "这份文件未能识别，请确认文件可以打开后重试。")}`,
          );
      }
    }
    return { count, errors };
  } finally {
    importing = false;
  }
}
async function backupTo(target?: string) {
  if (maintenance || importing) throw new Error("请等待导入或其他备份操作完成");
  maintenance = true;
  try {
    if (target) await createBackup(db, root, target);
    else target = await createAutoBackup(db, root);
    db.setSetting("lastBackup", new Date().toISOString());
    dirty = false;
    return target;
  } finally {
    maintenance = false;
  }
}
function setupHandlers() {
  handle("update-state", () => updates.snapshot());
  handle("check-for-updates", () => updates.check());
  handle("download-update", () => updates.download());
  handle("install-update", () => updates.install());
  handle("open-releases", () => shell.openExternal(RELEASES_URL));
  handle("ui-confirm-result", (requestId, confirmed) => {
    const accepted = z.boolean().parse(confirmed);
    if (pendingConfirmation?.id !== id.parse(requestId))
      throw new Error("确认请求已失效，请重试");
    pendingConfirmation.resolve(accepted);
  });
  handle("info", () => ({
    version: app.getVersion(),
    dataDir: root,
    engine: worker.available(),
    categories: CATEGORIES,
    lastBackup: db.setting("lastBackup"),
  }));
  handle(
    "choose-files",
    async () =>
      (
        await dialog.showOpenDialog(win, {
          title: "选择发票文件",
          properties: ["openFile", "multiSelections"],
          filters: [
            {
              name: "发票 PDF / 图片",
              extensions: [
                "pdf",
                "png",
                "jpg",
                "jpeg",
                "webp",
                "bmp",
                "tif",
                "tiff",
              ],
            },
          ],
        })
      ).filePaths,
  );
  handle("import-files", importFiles);
  handle("cancel-import", () => {
    cancelled = true;
    worker.stop();
  });
  handle("drafts", () => db.drafts());
  handle("discard-draft", (value) => {
    writable();
    db.discardDraft(id.parse(value));
    dirty = true;
  });
  handle("verify-drafts", (values, attribution) => {
    writable();
    const result = db.verifyDrafts(
      z.array(id).min(1).max(5000).parse(values),
      z.string().max(100).parse(attribution),
    );
    if (result.saved) dirty = true;
    return result;
  });
  handle("save-draft", (value, fields) => {
    writable();
    const result = db.saveDraft(id.parse(value), fields);
    if (result.id) dirty = true;
    return result;
  });
  handle("check-duplicate", (number, code) =>
    db.duplicate(
      z.string().max(30).parse(number).replace(/\s/g, ""),
      z.string().max(20).parse(code).replace(/\s/g, ""),
    ),
  );
  handle("list", (input) => db.list(filterSchema.parse(input)));
  handle("get-invoice", (value) => db.getInvoice(id.parse(value)));
  handle("update-invoice", (value, fields) => {
    writable();
    const result = db.updateInvoice(id.parse(value), fields);
    if (result.id) dirty = true;
    return result;
  });
  handle("permanently-delete-invoice", async (value) => {
    writable();
    const cleanup = db.deleteArchivedInvoice(id.parse(value));
    dirty = true;
    const warnings: string[] = [];
    if (cleanup.removePreview) {
      try {
        await fs.rm(within(root, cleanup.previewPath), { force: true });
      } catch {
        warnings.push("部分预览未能从磁盘清理");
      }
    }
    if (cleanup.removeOriginal) {
      try {
        await fs.rm(within(root, cleanup.storedPath), { force: true });
        await fs.rmdir(dirname(within(root, cleanup.previewPath))).catch(
          (error: NodeJS.ErrnoException) => {
            if (!["ENOENT", "ENOTEMPTY"].includes(error.code ?? ""))
              throw error;
          },
        );
      } catch {
        warnings.push("部分原件未能从磁盘清理");
      }
    }
    return { warnings };
  });
  handle("archive-invoice", (value, archived) => {
    writable();
    db.archiveInvoice(id.parse(value), z.boolean().parse(archived));
    dirty = true;
  });
  handle("stats", (month, dateBasis) =>
    db.stats(
      monthSchema.parse(month ?? ""),
      z.enum(["invoiceDate", "createdAt"]).parse(dateBasis ?? "invoiceDate"),
    ),
  );
  handle("preview", async (k, value) => {
    const resource = db.resource(kind.parse(k), id.parse(value));
    if (!resource) return null;
    const file = within(root, resource.previewPath);
    if ((await fs.stat(file)).size > 20_000_000)
      throw new Error("预览图过大，请打开原件");
    return `data:image/png;base64,${(await fs.readFile(file)).toString("base64")}`;
  });
  handle("open-original", async (k, value) => {
    const resource = db.resource(kind.parse(k), id.parse(value));
    if (!resource) throw new Error("找不到原始文件");
    const path = within(root, resource.storedPath);
    if (
      ![
        ".pdf",
        ".png",
        ".jpg",
        ".jpeg",
        ".webp",
        ".bmp",
        ".tif",
        ".tiff",
      ].includes(extname(path).toLowerCase())
    )
      throw new Error("不支持打开此文件");
    const error = await shell.openPath(path);
    if (error) throw new Error(error);
  });
  handle("open-data-dir", async () => {
    const error = await shell.openPath(root);
    if (error) throw new Error(error);
  });
  handle("export-excel", async (input) => {
    const filter: Filter = filterSchema.parse(input);
    const selected = await dialog.showSaveDialog(win, {
      defaultPath: `票迹-发票台账-${new Date().toISOString().slice(0, 10)}.xlsx`,
      filters: [{ name: "Excel 工作簿", extensions: ["xlsx"] }],
    });
    if (!selected.filePath) return null;
    const rows = db.list(filter, true).items;
    const workbook = new ExcelJS.Workbook();
    workbook.creator = "票迹";
    const sheet = workbook.addWorksheet("发票台账", {
      views: [{ state: "frozen", ySplit: 1 }],
    });
    sheet.columns = [
      ["发票号码", "invoiceNumber", 27],
      ["发票代码", "invoiceCode", 18],
      ["开票日期", "invoiceDate", 14],
      ["票种", "invoiceType", 22],
      ["购买方", "buyerName", 36],
      ["销售方", "sellerName", 42],
      ["购买方税号", "buyerTaxId", 24],
      ["销售方税号", "sellerTaxId", 24],
      ["票面项目", "itemName", 38],
      ["业务分类", "category", 20],
      ["归属", "attribution", 24],
      ["不含税金额", "amount", 18],
      ["税额", "tax", 16],
      ["价税合计", "total", 18],
      ["备注", "notes", 32],
      ["录入时间", "createdAt", 25],
      ["原始文件", "originalName", 38],
      ["PDF 页码", "page", 12],
      ["台账状态", "status", 16],
    ].map(([header, key, width]) => ({
      header: String(header),
      key: String(key),
      width: Number(width),
    }));
    for (const row of rows)
      sheet.addRow({
        ...row,
        amount: row.amountCents! / 100,
        tax: row.taxCents! / 100,
        total: row.totalCents! / 100,
        status: row.archived ? "已归档（不统计）" : "有效记录",
      });
    for (const name of [
      "invoiceNumber",
      "invoiceCode",
      "buyerTaxId",
      "sellerTaxId",
    ])
      sheet.getColumn(name).numFmt = "@";
    for (const name of ["amount", "tax", "total"])
      sheet.getColumn(name).numFmt = "#,##0.00;[Red]-#,##0.00";
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF173E36" },
    };
    sheet.getRow(1).height = 26;
    sheet.autoFilter = { from: "A1", to: "S1" };
    const summary = workbook.addWorksheet("分类汇总");
    summary.columns = [
      { header: "业务分类", key: "category", width: 25 },
      { header: "张数", key: "count", width: 15 },
      { header: "价税合计（元）", key: "total", width: 24 },
    ];
    const groups = new Map<
      string,
      { category: string; count: number; total: number }
    >();
    for (const r of rows) {
      const g = groups.get(r.category) ?? {
        category: r.category,
        count: 0,
        total: 0,
      };
      g.count++;
      g.total += r.totalCents!;
      groups.set(r.category, g);
    }
    for (const g of groups.values())
      summary.addRow({ ...g, total: g.total / 100 });
    summary.getColumn("total").numFmt = "#,##0.00";
    const note = workbook.addWorksheet("口径说明");
    note.getColumn(1).width = 120;
    for (const text of [
      "导出范围与当前台账筛选一致。",
      "金额为票面金额，默认统计口径为价税合计；不代表收入、支出或已报销金额。",
      `记录状态：${filter.archived ? "已归档记录" : "有效记录"}；月份：${filter.month || "全部"}；分类：${filter.category || "全部"}；归属：${filter.attribution === null ? "未标注" : filter.attribution || "全部"}`,
      "归属为核对时人工填写的自由文本，按相同文字分组。",
      "每张发票按一个分类汇总，包含多个项目的发票未拆分统计。",
    ])
      note.addRow([text]);
    await workbook.xlsx.writeFile(selected.filePath);
    return selected.filePath;
  });
  handle("backup", async () => {
    const selected = await dialog.showSaveDialog(win, {
      defaultPath: `票迹备份-${dateTag()}.piaoji`,
      filters: [{ name: "票迹完整备份", extensions: ["piaoji"] }],
    });
    return selected.filePath ? backupTo(selected.filePath) : null;
  });
  handle("restore", async () => {
    if (importing || maintenance) throw new Error("请等待导入或备份完成");
    const selected = await dialog.showOpenDialog(win, {
      filters: [{ name: "票迹完整备份", extensions: ["piaoji"] }],
      properties: ["openFile"],
    });
    if (!selected.filePaths.length) return false;
    const decision = await confirmInWindow({
      title: "恢复备份",
      description:
        "恢复会替换当前全部台账和原件，不会另存恢复前的备份。请确认所选文件无误，并仅恢复可信来源的文件。",
      details: `所选备份：${basename(selected.filePaths[0])}`,
      confirmLabel: "确认恢复",
      danger: true,
    });
    if (!decision) return false;
    if (importing || maintenance) throw new Error("请等待导入或备份完成");
    maintenance = true;
    worker.stop();
    const staging = within(root, `.restore-${randomUUID()}`),
      rollback = within(root, `.rollback-${randomUUID()}`);
    const components = ["invoices.db", "originals", "previews"];
    let closed = false,
      cleanupSafe = false;
    const movedOld: string[] = [],
      movedNew: string[] = [];
    try {
      await unpackBackup(selected.filePaths[0], staging);
      db.db.pragma("wal_checkpoint(TRUNCATE)");
      db.close();
      closed = true;
      await fs.mkdir(rollback);
      for (const suffix of ["-wal", "-shm"])
        await fs.rm(within(root, `invoices.db${suffix}`), { force: true });
      for (const name of components) {
        await fs.rename(within(root, name), join(rollback, name));
        movedOld.push(name);
      }
      for (const name of components) {
        await fs.rename(join(staging, name), within(root, name));
        movedNew.push(name);
      }
      db = new LedgerDB(join(root, "invoices.db"));
      closed = false;
      db.event("restore", "database");
      dirty = true;
      cleanupSafe = true;
      return true;
    } catch (error) {
      if (closed) {
        for (const name of movedNew.reverse())
          await fs.rename(within(root, name), join(staging, name));
        for (const name of movedOld.reverse())
          await fs.rename(join(rollback, name), within(root, name));
        db = new LedgerDB(join(root, "invoices.db"));
      }
      cleanupSafe = true;
      throw error;
    } finally {
      maintenance = false;
      // Never remove the rollback copy if a filesystem failure interrupted recovery.
      if (cleanupSafe) {
        await fs.rm(staging, { recursive: true, force: true }).catch(() => {});
        await fs.rm(rollback, { recursive: true, force: true }).catch(() => {});
      }
    }
  });
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app
    .whenReady()
    .then(async () => {
      for (const folder of ["", "originals", "previews", "backups"])
        await fs.mkdir(join(root, folder), { recursive: true });
      db = new LedgerDB(join(root, "invoices.db"));
      worker = new OCRWorker(root);
      win = new BrowserWindow({
        width: 1440,
        height: 940,
        minWidth: 980,
        minHeight: 700,
        backgroundColor: "#e5eef5",
        title: "票迹 · 发票台账",
        titleBarStyle: "hidden",
        titleBarOverlay: {
          color: "#00000000",
          symbolColor: "#4e6680",
          height: 38,
        },
        icon: join(app.getAppPath(), "build", "icon.ico"),
        autoHideMenuBar: true,
        show: false,
        webPreferences: {
          preload: join(__dirname, "preload.cjs"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
          webSecurity: true,
        },
      });
      win.removeMenu();
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      win.webContents.on("will-navigate", (event) => event.preventDefault());
      win.webContents.session.setPermissionRequestHandler(
        (_wc, _permission, callback) => callback(false),
      );
      autoUpdater.logger = null;
      updates = new UpdateService(
        autoUpdater,
        app.isPackaged && existsSync(join(dirname(app.getPath("exe")), "Uninstall 票迹.exe")),
        (state) => {
          if (state.status === "error" && updateInstalling) {
            maintenance = false;
            closing = false;
            updateInstalling = false;
          }
          if (!win.isDestroyed() && !win.webContents.isDestroyed())
            win.webContents.send("update-state-changed", state);
        },
        async () => {
          if (importing || maintenance || pendingConfirmation)
            throw new Error("请先完成导入、备份或当前确认操作，再安装更新。");
          const accepted = await confirmInWindow({
            title: "安装更新并退出",
            description: "票迹会退出并打开新版安装程序，不会额外创建备份。请先保存正在编辑的内容；安装时保留原安装位置。",
            confirmLabel: "退出并安装",
          });
          if (!accepted) return false;
          if (importing || maintenance)
            throw new Error("请等待导入或备份完成，再安装更新。");
          maintenance = true;
          updateInstalling = true;
          try {
            worker.stop();
            closing = true;
            return true;
          } catch (error) {
            maintenance = false;
            updateInstalling = false;
            throw error;
          }
        },
      );
      setupHandlers();
      win.once("ready-to-show", () => win.show());
      win.on("close", (event) => {
        if (closing) return;
        if (importing || maintenance) {
          event.preventDefault();
          win.webContents.send(
            "ui-notice",
            "请先取消导入或等待备份完成，再关闭软件。",
          );
          return;
        }
        if (pendingConfirmation) {
          event.preventDefault();
          return;
        }
        if (dirty) {
          event.preventDefault();
          void (async () => {
            try {
              await backupTo();
              closing = true;
              win.close();
            } catch (error) {
              const answer = await confirmInWindow({
                title: "关闭前自动备份失败",
                description:
                  "已保存的记录仍保留在这台电脑里。你可以返回票迹重试备份，或不备份直接退出。",
                details: userError(
                  error,
                  "暂时无法完成备份，请检查保存位置和可用空间后重试。",
                ),
                cancelLabel: "返回软件",
                confirmLabel: "不备份并关闭",
                danger: true,
              });
              if (answer) {
                closing = true;
                win.close();
              }
            }
          })();
        }
      });
      const dev = process.env.VITE_DEV_SERVER_URL;
      if (dev && !app.isPackaged) await win.loadURL(dev);
      else
        await win.loadURL(
          pathToFileURL(join(__dirname, "..", "dist", "index.html")).href,
        );
      const updateTimer = setTimeout(() => {
        if (!win.isDestroyed()) void updates.check();
      }, 12000);
      updateTimer.unref();
      win.once("closed", () => clearTimeout(updateTimer));
    })
    .catch((error) => {
      dialog.showErrorBox(
        "暂时无法打开票迹",
        userError(
          error,
          "请重新打开票迹；若仍无法打开，请保留账本文件，并联系维护人员。",
        ),
      );
      app.quit();
    });
  app.on("window-all-closed", () => app.quit());
  app.on("will-quit", () => {
    worker?.stop();
    if (db?.db.open) db.close();
  });
}
