import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import { randomUUID } from "node:crypto";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const previous = JSON.parse(
  await fs.readFile("output/smoke/results.json", "utf8"),
);
assert.equal(previous.passed, true, "Run test:smoke first");
const data = resolve(".test-data", "ui-current");
const output = resolve("output", "playwright", "glass-app");
await fs.rm(data, { recursive: true, force: true });
await fs.mkdir(data, { recursive: true });
await fs.mkdir(output, { recursive: true });
for (const name of ["invoices.db", "originals", "previews"]) {
  await fs.cp(join(previous.data, name), join(data, name), { recursive: true });
}
const batchDb = new (require("better-sqlite3"))(join(data, "invoices.db"));
try {
  const now = new Date().toISOString();
  await fs.writeFile(join(data, "originals", "batch-a.pdf"), "batch-a");
  await fs.writeFile(join(data, "previews", "batch-a.png"), "");
  for (const [number, itemName, amount] of [
    ["20000000000000000011", "批量办公用品甲", 10000],
    ["20000000000000000012", "批量办公用品乙", 20000],
  ]) {
    const documentId = randomUUID();
    const draftId = randomUUID();
    batchDb
      .prepare("INSERT INTO documents VALUES (?,?,?,?,?)")
      .run(
        documentId,
        "批量核对.pdf",
        "originals/batch-a.pdf",
        documentId,
        now,
      );
    batchDb
      .prepare("INSERT INTO drafts VALUES (?,?,?,?,?,?)")
      .run(
        draftId,
        documentId,
        1,
        "previews/batch-a.png",
        JSON.stringify({
          invoiceNumber: number,
          invoiceCode: "",
          invoiceDate: "2026-09-08",
          invoiceType: "普通发票",
          buyerName: "测试购买方",
          sellerName: "测试销售方",
          buyerTaxId: "",
          sellerTaxId: "",
          itemName,
          category: "办公用品",
          attribution: "",
          amountCents: amount,
          taxCents: 1300,
          totalCents: amount + 1300,
          notes: "",
        }),
        now,
      );
  }
} finally {
  batchDb.close();
}
const env = { ...process.env, INVOICE_LEDGER_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
  args: ["."],
  executablePath: require("electron"),
  env,
});
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
await page.emulateMedia({ reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
const click = (locator) => locator.click();
const button = (name) => page.getByRole("button", { name, exact: true });
const screenshot = (name) =>
  page.screenshot({ path: join(output, `${name}.png`) });
async function insideViewport(locator) {
  const bounds = await locator.boundingBox();
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  assert.ok(
    bounds &&
      bounds.x >= 0 &&
      bounds.y >= 0 &&
      bounds.x + bounds.width <= viewport.width + 1 &&
      bounds.y + bounds.height <= viewport.height + 1,
    JSON.stringify({ bounds, viewport }),
  );
}
async function focused(locator) {
  await page.waitForFunction(
    (element) => element === document.activeElement,
    await locator.elementHandle(),
    { timeout: 3000 },
  );
}
try {
  await page
    .getByRole("heading", { name: "全部记录 2", exact: true })
    .waitFor();
  const ledger = page.getByRole("table", { name: "发票台账", exact: true });
  assert.deepEqual(await ledger.locator("thead th").allTextContents(), [
    "发票号码 / 开票日期",
    "销售方 / 项目",
    "分类",
    "不含税金额",
    "税额",
    "价税合计",
    "操作",
  ]);
  assert.deepEqual(await ledger.locator("tfoot td.amount").allTextContents(), [
    "¥ 55,684.80",
    "¥ 736.39",
    "¥ 56,421.19",
  ]);
  const exemptRow = ledger
    .locator("tbody tr")
    .filter({ hasText: "20000000000000000101" });
  assert.deepEqual(await exemptRow.locator("td.amount").allTextContents(), [
    "¥ 43,411.70",
    "¥ 0.00",
    "¥ 43,411.70",
  ]);
  assert.equal(await page.locator(".breadcrumb, .user-avatar").count(), 0);
  const chrome = await page.evaluate(() => {
    const overlay = navigator.windowControlsOverlay;
    const rect = overlay.getTitlebarAreaRect();
    const drag = document.querySelector(".window-drag-region");
    return {
      visible: overlay.visible,
      width: rect.width,
      height: rect.height,
      viewport: innerWidth,
      dragWidth: drag.getBoundingClientRect().width,
      dragStyle: getComputedStyle(drag).getPropertyValue("-webkit-app-region"),
    };
  });
  assert.equal(chrome.visible, true);
  assert.ok(chrome.width > 0 && chrome.width < chrome.viewport);
  assert.ok(chrome.height >= 32 && chrome.height <= 42);
  assert.ok(chrome.dragWidth <= chrome.width);
  assert.equal(chrome.dragStyle, "drag");
  assert.ok(
    (await page.locator("#root").boundingBox()).y >= 38,
    "Content scrolling starts below the titlebar",
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise((done) => {
      win.once("maximize", done);
      win.maximize();
    });
  });
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMaximized(),
    ),
    true,
  );
  await screenshot("maximized");
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise((done) => {
      win.once("unmaximize", done);
      win.unmaximize();
    });
    await new Promise((done) => {
      win.once("minimize", done);
      win.minimize();
    });
  });
  assert.equal(
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].isMinimized(),
    ),
    true,
  );
  await app.evaluate(async ({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows()[0];
    await new Promise((done) => {
      win.once("restore", done);
      win.restore();
    });
  });
  await screenshot("window-chrome");
  // Page screenshots omit native overlay buttons; capture only this test window.
  const nativeWindow = await app.evaluate(
    async ({ BrowserWindow, desktopCapturer }) => {
      const win = BrowserWindow.getAllWindows()[0];
      const sources = await desktopCapturer.getSources({
        types: ["window"],
        thumbnailSize: { width: 2000, height: 1400 },
      });
      return sources
        .find((source) => source.id === win.getMediaSourceId())
        ?.thumbnail.toDataURL();
    },
  );
  assert.ok(
    nativeWindow,
    "Capture the actual test window including native controls",
  );
  await fs.writeFile(
    join(output, "native-window.png"),
    Buffer.from(nativeWindow.split(",")[1], "base64"),
  );
  const filter = page.getByRole("combobox", {
    name: "业务分类筛选",
    exact: true,
  });
  await click(filter);
  await insideViewport(page.getByRole("listbox"));
  await screenshot("category-menu");
  await click(page.getByRole("option", { name: "物业费", exact: true }));
  await page
    .getByRole("heading", { name: "全部记录 1", exact: true })
    .waitFor();
  assert.deepEqual(await ledger.locator("tfoot td.amount").allTextContents(), [
    "¥ 12,273.10",
    "¥ 736.39",
    "¥ 13,009.49",
  ]);
  await focused(filter);
  await filter.press("Space");
  await focused(page.getByRole("option", { name: "物业费", exact: true }));
  await page.keyboard.press("Home");
  await focused(page.getByRole("option", { name: "全部分类", exact: true }));
  await page.keyboard.press("Enter");
  await page
    .getByRole("heading", { name: "全部记录 2", exact: true })
    .waitFor();
  await click(filter);
  await page.keyboard.press("Escape");
  await focused(filter);

  const monthButton = button("开票月份筛选");
  await click(monthButton);
  const year = page.getByRole("textbox", { name: "年份", exact: true });
  await year.focus();
  await year.press("Control+a");
  await year.press("Backspace");
  await year.pressSequentially("2026");
  assert.equal(await year.inputValue(), "2026");
  await screenshot("month-picker");
  await click(button("9 月"));
  await focused(monthButton);
  await page
    .getByRole("heading", { name: "全部记录 2", exact: true })
    .waitFor();
  await click(monthButton);
  await click(button("10 月"));
  await page
    .getByRole("heading", { name: "全部记录 0", exact: true })
    .waitFor();
  assert.deepEqual(await ledger.locator("tfoot td.amount").allTextContents(), [
    "¥ 0.00",
    "¥ 0.00",
    "¥ 0.00",
  ]);
  await click(monthButton);
  await click(button("全部月份"));
  await page
    .getByRole("heading", { name: "全部记录 2", exact: true })
    .waitFor();

  await click(button("统计汇总"));
  const basis = page.getByRole("combobox", {
    name: "统计时间口径",
    exact: true,
  });
  await page
    .getByRole("columnheader", { name: "开票月份", exact: true })
    .waitFor();
  await page.locator('.report-metrics[aria-busy="false"]').waitFor();
  assert.match(
    await page.locator(".report-metrics .metric").nth(1).innerText(),
    /55,684\.80/,
  );
  await screenshot("reports-invoice-time");
  await click(basis);
  await click(page.getByRole("option", { name: "按录入时间", exact: true }));
  await focused(basis);
  await page
    .getByRole("columnheader", { name: "录入月份", exact: true })
    .waitFor();
  await page.locator('.report-metrics[aria-busy="false"]').waitFor();
  const entries = await page.evaluate(
    async () => (await window.ledger.list({})).items,
  );
  const localMonth = (value) => {
    const date = new Date(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  };
  assert.match(
    await page.getByRole("table", { name: "月度记录" }).innerText(),
    new RegExp(localMonth(entries[0].createdAt)),
  );
  await screenshot("reports-entry-time");
  await click(button("统计月份"));
  await page.getByRole("textbox", { name: "年份", exact: true }).fill("2026");
  await click(button("9 月"));
  await page.locator('.report-metrics[aria-busy="false"]').waitFor();
  const septemberEntries = entries.filter(
    (r) => localMonth(r.createdAt) === "2026-09",
  );
  assert.match(
    await page.locator(".report-metrics .metric").last().innerText(),
    new RegExp(`${septemberEntries.length}\\s*张`),
  );
  assert.equal(
    await page.locator(".bar-row").count(),
    new Set(septemberEntries.map((r) => r.category)).size,
  );
  assert.equal(
    await page.locator(".rank-list > div").count(),
    new Set(septemberEntries.map((r) => r.sellerName)).size,
  );
  await click(basis);
  await click(page.getByRole("option", { name: "按开票时间", exact: true }));
  await page.locator('.report-metrics[aria-busy="false"]').waitFor();
  assert.match(
    await page.locator(".report-metrics .metric").last().innerText(),
    /2\s*张/,
  );
  assert.equal(await page.locator(".bar-row").count(), 2);
  await click(button("全部日期"));
  await click(button("发票台账"));

  const opener = button("查看发票 20000000000000000001");
  await click(opener);
  await page.getByRole("dialog", { name: /发票详情/ }).waitFor();
  assert.ok(
    await page.locator(".record-timestamp time").getAttribute("datetime"),
  );
  const editorBounds = await page
    .getByRole("dialog", { name: /发票详情/ })
    .boundingBox();
  assert.ok(
    editorBounds.y > 38,
    "Editor must not cover the draggable titlebar",
  );
  const date = page.getByRole("textbox", { name: "开票日期", exact: false });
  await date.fill("2026-09-07");
  await click(button("选择开票日期"));
  await insideViewport(page.locator(".date-popover"));
  await button("2026-09-07").focus();
  await page.keyboard.press("ArrowRight");
  await focused(button("2026-09-08"));
  await page.keyboard.press("PageDown");
  await focused(button("2026-10-01"));
  await page.keyboard.press("ArrowLeft");
  await focused(button("2026-09-30"));
  await screenshot("date-picker");
  await page.keyboard.press("Enter");
  assert.equal(await date.inputValue(), "2026-09-30");
  await focused(button("选择开票日期"));

  const category = page.getByRole("combobox", {
    name: "业务分类",
    exact: true,
  });
  await click(category);
  await insideViewport(page.getByRole("listbox"));
  await screenshot("editor-category");
  await page.keyboard.press("Escape");
  await focused(category);
  await click(button("关闭核对窗口"));
  const discard = page.getByRole("alertdialog", {
    name: "放弃未保存的修改？",
    exact: true,
  });
  await discard.waitFor();
  await focused(discard.getByRole("button", { name: "取消", exact: true }));
  await screenshot("unsaved-confirm");
  await page.keyboard.press("Escape");
  await discard.waitFor({ state: "detached" });
  await page.getByRole("dialog", { name: /发票详情/ }).waitFor();
  assert.equal(await date.inputValue(), "2026-09-30");
  await focused(button("关闭核对窗口"));
  await click(button("关闭核对窗口"));
  await click(button("放弃修改"));
  await page.getByRole("dialog").waitFor({ state: "detached" });
  await focused(opener);

  await click(opener);
  await click(button("归档此记录"));
  await page
    .getByRole("alertdialog", { name: "将这条发票记录归档？", exact: true })
    .waitFor();
  await click(button("取消"));
  await page.getByRole("alertdialog").waitFor({ state: "detached" });
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 2);
  await click(button("关闭核对窗口"));
  await focused(opener);

  // A cancelled or interrupted restore must not replace the current database.
  const firstId = await page.evaluate(
    async () => (await window.ledger.list({})).items[0].id,
  );
  await page.evaluate((id) => window.ledger.archiveInvoice(id, true), firstId);
  await app.evaluate(
    ({ dialog }, filePath) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [filePath],
      });
    },
    resolve("output", "smoke", "complete.piaoji"),
  );
  await page.evaluate(() => {
    window.restoreResult = window.ledger.restore();
  });
  await page
    .getByRole("alertdialog", { name: "恢复备份", exact: true })
    .waitFor();
  assert.equal(
    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows()[0];
      win.close();
      return win.isDestroyed();
    }),
    false,
    "Window close must respect pending confirmation",
  );
  await click(button("取消"));
  assert.equal(await page.evaluate(() => window.restoreResult), false);
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 1);
  await page.evaluate(() => {
    window.restoreResult = window.ledger.restore();
  });
  await page
    .getByRole("alertdialog", { name: "恢复备份", exact: true })
    .waitFor();
  await page.reload();
  await page
    .getByRole("heading", { name: "全部记录 1", exact: true })
    .waitFor();
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 1);
  await click(button("切换归档记录"));
  await page
    .getByRole("heading", { name: "归档记录 1", exact: true })
    .waitFor();
  assert.equal(await ledger.locator("tfoot").count(), 0);
  assert.equal(await ledger.locator("tbody td.amount").count(), 3);
  await click(button("切换归档记录"));
  await page
    .getByRole("heading", { name: "全部记录 1", exact: true })
    .waitFor();
  await page.evaluate(() => {
    window.restoreResult = window.ledger.restore();
  });
  await page
    .getByRole("alertdialog", { name: "恢复备份", exact: true })
    .waitFor();
  await click(button("取消"));
  assert.equal(await page.evaluate(() => window.restoreResult), false);
  await page.evaluate((id) => window.ledger.archiveInvoice(id, false), firstId);
  await page.reload();
  await page
    .getByRole("heading", { name: "全部记录 2", exact: true })
    .waitFor();

  await page.keyboard.press("Control+k");
  await focused(page.getByRole("textbox", { name: "搜索发票", exact: true }));
  await screenshot("ledger");
  await ledger.screenshot({ path: join(output, "ledger-amounts.png") });
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 740),
  );
  assert.equal(
    await page.evaluate(() => {
      const root = document.getElementById("root");
      return (
        document.documentElement.scrollWidth <= innerWidth &&
        root.scrollWidth <= root.clientWidth
      );
    }),
    true,
  );
  await screenshot("compact-ledger");
  assert.equal(
    await ledger.locator("td.amount").evaluateAll((cells) =>
      cells.every((cell) => {
        const range = document.createRange();
        range.selectNodeContents(cell);
        const text = range.getBoundingClientRect();
        const box = cell.getBoundingClientRect();
        return text.left >= box.left + 6 && text.right <= box.right - 6;
      }),
    ),
    true,
    "Monetary columns must not overlap at compact width",
  );
  await click(filter);
  await insideViewport(page.getByRole("listbox"));
  await screenshot("compact-menu");
  await page.keyboard.press("Escape");
  await click(opener);
  await click(button("选择开票日期"));
  await insideViewport(page.locator(".date-popover"));
  await screenshot("compact-calendar");
  await page.keyboard.press("Escape");
  await click(button("关闭核对窗口"));
  await click(button("统计汇总"));
  await click(basis);
  await click(page.getByRole("option", { name: "按录入时间", exact: true }));
  await page.locator('.report-metrics[aria-busy="false"]').waitFor();
  await screenshot("compact-reports-entry-time");
  assert.equal(
    await page.evaluate(() => {
      const root = document.getElementById("root");
      return root.scrollWidth <= root.clientWidth;
    }),
    true,
  );
  await click(
    page
      .getByRole("navigation")
      .getByRole("button", { name: "数据与备份", exact: true }),
  );
  await screenshot("settings");
  await click(
    page
      .getByRole("navigation")
      .getByRole("button", { name: /导入与核对/ }),
  );
  await page
    .getByRole("textbox", { name: "批量归属", exact: true })
    .fill("重复批次");
  const modalScrollBefore = await page.evaluate(() => {
    const root = document.getElementById("root");
    root.scrollTop = 0;
    const bodyStyle = getComputedStyle(document.body);
    return {
      scrollTop: root.scrollTop,
      brandTop: document.querySelector(".brand").getBoundingClientRect().top,
      headerTop: document.querySelector(".app-header").getBoundingClientRect().top,
      bodyPaddingTop: bodyStyle.paddingTop,
      bodyHeight: bodyStyle.height,
      bodyOverflow: bodyStyle.overflow,
    };
  });
  await page
    .getByRole("checkbox", { name: "全选待核对", exact: true })
    .check();
  await click(button("一键全部核对"));
  const batchDialog = page.getByRole("alertdialog", {
    name: "一键核对全部发票？",
    exact: true,
  });
  await batchDialog.waitFor();
  const modalScrollAfter = await page.evaluate(() => {
    const root = document.getElementById("root");
    const bodyStyle = getComputedStyle(document.body);
    return {
      scrollTop: root.scrollTop,
      brandTop: document.querySelector(".brand").getBoundingClientRect().top,
      headerTop: document.querySelector(".app-header").getBoundingClientRect().top,
      bodyPaddingTop: bodyStyle.paddingTop,
      bodyHeight: bodyStyle.height,
      bodyOverflow: bodyStyle.overflow,
    };
  });
  assert.deepEqual(modalScrollAfter, modalScrollBefore);
  await screenshot("batch-confirm");
  await click(
    batchDialog.getByRole("button", { name: "核对并保存", exact: true }),
  );
  await page.getByText("2 张发票未完成核对", { exact: true }).waitFor();
  assert.equal(
    (await page.evaluate(() => window.ledger.drafts())).length,
    2,
  );
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 4);
  await screenshot("batch-failures");
  await click(button("统计汇总"));
  await page.locator('.report-metrics[aria-busy="false"]').waitFor();
  const attributionReport = page.getByRole("table", {
    name: "按归属统计",
    exact: true,
  });
  await attributionReport.waitFor();
  assert.match(await attributionReport.innerText(), /重复批次[\s\S]*2 张/);
  await screenshot("batch-attribution-report");
  assert.doesNotMatch(
    await page.locator("body").innerText(),
    /SQLite|OCR|Electron|数据库|识别引擎|npm\s|唯一索引|入库/,
  );
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    data,
    output,
    checks: [
      "select mouse and keyboard",
      "select and calendar viewport collision",
      "month/year selection",
      "date typing and cross-month keyboard navigation",
      "nested dialog escape and safe focus",
      "focus returned to opener",
      "unsaved edits preserved on cancel",
      "archive cancel",
      "restore cancel and renderer reload cancel",
      "Ctrl+K search",
      "compact window",
      "native window overlay, reserved drag region and minimize/maximize/restore",
      "window close respects pending confirmation",
      "removed breadcrumb/avatar and product-facing settings copy",
      "no renderer errors",
      "net amount and tax columns, exempt tax and filtered all-page totals",
      "entry timestamp in invoice details",
      "invoice-time / local entry-time report switching, months and grouped totals",
      "compact monetary columns without overlapping text",
      "batch verification keeps duplicate failures pending",
      "batch success groups shared attribution in reports",
      "dialogs do not scroll the background",
    ],
  };
  await fs.writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await screenshot("failure");
  console.error(await page.locator("body").ariaSnapshot());
  throw error;
} finally {
  await app.close();
}
