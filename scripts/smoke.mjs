import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";

const require = createRequire(import.meta.url);
const output = resolve("output", "smoke");
await fs.mkdir(output, { recursive: true });
const data = resolve(".test-data", `smoke-${Date.now()}`);
const samples = [process.env.SAMPLE_PDF, process.env.SAMPLE_IMAGE].filter(
  Boolean,
);
if (samples.length !== 2)
  throw new Error(
    "Set SAMPLE_PDF and SAMPLE_IMAGE to the two supplied invoice samples",
  );
const env = { ...process.env, INVOICE_LEDGER_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const application = await electron.launch({
  args: ["."],
  executablePath: require("electron"),
  env,
  timeout: 30000,
});
const page = await application.firstWindow();
await page.emulateMedia({ reducedMotion: "reduce" });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});
try {
  await page.waitForFunction(() => !!window.ledger);
  await page.getByRole("heading", { name: "第一张发票，从这里开始" }).waitFor();
  await application.evaluate(({ dialog }, files) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: files });
  }, samples);
  await page
    .getByRole("button", { name: "导入第一张发票", exact: true })
    .click({ force: true });
  await page
    .getByRole("heading", { name: "待核对发票 2", exact: true })
    .waitFor({ timeout: 120000 });
  const drafts = await page.evaluate(() => window.ledger.drafts());
  assert.deepEqual(drafts.map((d) => d.invoiceNumber).sort(), [
    "20000000000000000101",
    "20000000000000000001",
  ]);
  for (let i = 0; i < 2; i++) {
    await page
      .getByRole("button", { name: "核对", exact: true })
      .first()
      .click({ force: true });
    await page
      .getByRole("img", { name: "发票原件预览", exact: true })
      .waitFor();
    assert.doesNotMatch(
      await page.locator("body").innerText(),
      /SQLite|OCR|Electron|数据库|识别引擎|文字解析|入库/,
    );
    assert.equal(
      await page
        .getByRole("button", { name: "确认并保存", exact: true })
        .isDisabled(),
      true,
    );
    await page.screenshot({ path: join(output, `review-${i}.png`) });
    await page
      .getByRole("checkbox", { name: "我已核对发票号码、日期和金额，确认无误" })
      .check({ force: true });
    await page
      .getByRole("button", { name: "确认并保存", exact: true })
      .click({ force: true });
    await page.getByRole("dialog").waitFor({ state: "detached" });
  }
  assert.equal(
    (await page.evaluate(() => window.ledger.stats())).totalCents,
    5642119,
  );
  await page
    .getByRole("button", { name: "发票台账", exact: true })
    .click({ force: true });
  await page
    .getByRole("heading", { name: "全部记录 2", exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "ledger.png") });
  await page
    .getByRole("textbox", { name: "搜索发票", exact: true })
    .fill("20000000000000000001");
  await page
    .getByRole("heading", { name: "全部记录 1", exact: true })
    .waitFor();
  await page
    .getByRole("button", { name: "重置", exact: true })
    .click({ force: true });
  await page
    .getByRole("heading", { name: "全部记录 2", exact: true })
    .waitFor();
  const exportPath = join(output, "ledger.xlsx");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, exportPath);
  await page.evaluate(() => window.ledger.exportExcel({}));
  const excel = new ExcelJS.Workbook();
  await excel.xlsx.readFile(exportPath);
  const sheet = excel.getWorksheet("发票台账");
  assert.equal(sheet.rowCount, 3);
  assert.equal(typeof sheet.getCell("A2").value, "string");
  assert.equal(sheet.getCell("A2").value.length, 20);
  const backupPath = join(output, "complete.piaoji");
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showSaveDialog = async () => ({ canceled: false, filePath });
  }, backupPath);
  assert.equal(await page.evaluate(() => window.ledger.backup()), backupPath);
  const firstId = await page.evaluate(
    async () => (await window.ledger.list({})).items[0].id,
  );
  await page.evaluate((id) => window.ledger.archiveInvoice(id, true), firstId);
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 1);
  await application.evaluate(({ dialog }, filePath) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [filePath],
    });
  }, backupPath);
  await page.evaluate(() => {
    window.restoreResult = window.ledger.restore();
  });
  await page
    .getByRole("alertdialog", { name: "恢复备份", exact: true })
    .waitFor();
  await page.screenshot({ path: join(output, "restore-confirm.png") });
  await page
    .getByRole("button", { name: "确认恢复", exact: true })
    .click({ force: true });
  assert.equal(await page.evaluate(() => window.restoreResult), true);
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 2);
  assert.ok(
    await page.evaluate((id) => window.ledger.preview("invoice", id), firstId),
  );
  const cancelled = await page.evaluate(async (path) => {
    const started = new Promise((resolveStarted) => {
      const off = window.ledger.onProgress(() => {
        off();
        resolveStarted();
      });
    });
    const task = window.ledger.importFiles([path]);
    await started;
    await window.ledger.cancelImport();
    return task;
  }, samples[1]);
  assert.equal(cancelled.count, 0);
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 2);
  await page.evaluate((paths) => window.ledger.importFiles(paths), samples);
  const duplicates = await page.evaluate(() => window.ledger.drafts());
  assert.equal(duplicates.length, 2);
  assert.ok(duplicates.every((d) => d.duplicate));
  const denied = await page.evaluate(async () => {
    const d = (await window.ledger.drafts())[0];
    return window.ledger.saveDraft(d.id, d);
  });
  assert.ok(denied.duplicate);
  assert.equal((await page.evaluate(() => window.ledger.stats())).count, 2);
  await page.reload();
  await page
    .getByRole("button", { name: "导入与核对 2", exact: true })
    .click({ force: true });
  await page
    .getByRole("button", { name: "核对", exact: true })
    .first()
    .click({ force: true });
  await page.getByText("这张发票已经录过了", { exact: true }).waitFor();
  assert.equal(
    await page
      .getByRole("button", { name: "已记录，无需重复保存", exact: true })
      .isDisabled(),
    true,
  );
  await page.screenshot({ path: join(output, "duplicate.png") });
  await page
    .getByRole("button", { name: "关闭核对窗口", exact: true })
    .click({ force: true });
  await page
    .getByRole("button", { name: "统计汇总", exact: true })
    .click({ force: true });
  await page.screenshot({ path: join(output, "reports.png") });
  await application.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1000, 740),
  );
  await page.screenshot({ path: join(output, "compact.png") });
  assert.deepEqual(errors, []);
  const result = {
    passed: true,
    checks: [
      "real PDF and image import",
      "manual confirmation gate",
      "exact invoice numbers",
      "integer cents total",
      "search and reset",
      "Excel text identifiers",
      "full backup",
      "restore database and original previews",
      "duplicate UI and database rejection",
      "import cancellation and subsequent retry",
      "compact layout",
      "no renderer exceptions",
    ],
    data,
    output,
  };
  await fs.writeFile(
    join(output, "results.json"),
    JSON.stringify(result, null, 2),
  );
  console.log(JSON.stringify(result, null, 2));
} finally {
  await application.close();
}
