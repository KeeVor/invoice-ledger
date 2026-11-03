import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import { build } from "esbuild";
import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";

const require = createRequire(import.meta.url);
const data = resolve(".test-data", "updates-current");
const output = resolve("output", "playwright", "updates");
await fs.rm(data, { recursive: true, force: true });
await fs.mkdir(data, { recursive: true });
await fs.mkdir(output, { recursive: true });
await build({ entryPoints: ["electron/updates.ts"], bundle: true, platform: "node", format: "cjs", outfile: ".test-data/update-service.cjs" });
const env = { ...process.env, INVOICE_LEDGER_DATA_DIR: data };
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({ args: ["."], executablePath: require("electron"), env });
const page = await app.firstWindow();
page.setDefaultTimeout(10000);
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
const button = (name) => page.getByRole("button", { name, exact: true });
const navigate = (name) => page.getByRole("navigation", { name: "主导航" }).getByRole("button", { name, exact: true }).click();
try {
  await page.waitForFunction(() => !!window.ledger);
  assert.equal((await page.evaluate(() => window.ledger.updateState())).status, "disabled");
  assert.equal((await page.evaluate(() => window.ledger.checkForUpdates())).status, "disabled");
  await navigate("数据与备份");
  await page.getByRole("heading", { name: "让票迹，保持新鲜" }).waitFor();
  await page.getByText("应用内更新未启用", { exact: true }).waitFor();
  assert.equal(await button("检查更新").count(), 0);

  // Test-only main-process adapters exercise the real IPC bridge and update panel.
  await app.evaluate(({ ipcMain, BrowserWindow }, servicePath) => {
    const require = process.getBuiltinModule("node:module").createRequire(servicePath);
    const { EventEmitter } = require("node:events");
    const { UpdateService } = require(servicePath);
    const adapter = new EventEmitter();
    const test = globalThis.__updatesTest = { installs: 0, downloads: 0, failCheck: false, failPrepare: false, releaseNotesFail: false, ready: false };
    const send = (channel, payload) => BrowserWindow.getAllWindows()[0].webContents.send(channel, payload);
    adapter.checkForUpdates = async () => {
      if (test.failCheck) throw new Error("simulated network outage");
      adapter.emit("update-available", {
        version: "0.4.3",
        releaseNotes:
          '<h2>票迹 v0.4.3</h2><ul><li>批量核对</li><li>永久删除</li></ul><img src=x onerror="alert(1)"><script>alert(1)</script>\nSynthetic release notes',
      });
    };
    adapter.downloadUpdate = async () => {
      test.downloads++;
      adapter.emit("download-progress", { percent: 42.5 });
      await new Promise((r) => setTimeout(r, 150));
      adapter.emit("update-downloaded");
    };
    adapter.quitAndInstall = () => { test.installs++; };
    let confirm;
    const service = new UpdateService(adapter, true, (s) => send("update-state-changed", s), async () => {
      send("ui-confirm", { id: "00000000-0000-4000-8000-000000000001", title: "安装更新并退出", description: "Synthetic confirmation; no installer will run.", confirmLabel: "退出并安装" });
      const accepted = await new Promise((r) => { confirm = r; });
      if (accepted && test.failPrepare) throw new Error("测试安装条件不满足，安装已停止。");
      return accepted;
    });
    const handlers = {
      "update-state": () => service.snapshot(),
      "check-for-updates": () => service.check(),
      "download-update": () => service.download(),
      "install-update": () => service.install(),
      "release-notes": () => {
        if (test.releaseNotesFail) throw new Error("simulated notes outage");
        return {
          format: 1,
          releases: [
            {
              version: "0.4.3",
              added: ["按版本展示更新说明", "增加更新内容对话框"],
              fixed: [],
              changed: [],
            },
            {
              version: "0.4.2",
              added: [],
              fixed: ["更新说明 HTML 标签显示问题"],
              changed: ["更新说明改为纯文本渲染"],
            },
            {
              version: "0.4.1",
              added: ["不应显示的旧版本"],
              fixed: [],
              changed: [],
            },
          ],
        };
      },
      "ui-confirm-result": (_, id, accepted) => { confirm(accepted); },
    };
    for (const [name, handler] of Object.entries(handlers)) {
      ipcMain.removeHandler(name);
      ipcMain.handle(name, handler);
    }
    test.ready = true;
  }, resolve(".test-data/update-service.cjs"));
  await navigate("发票台账");
  await navigate("数据与备份");
  await button("检查更新").click();
  await button("下载更新").waitFor();
  assert.equal(await app.evaluate(() => globalThis.__updatesTest.downloads), 0);
  await button("查看更新内容").click();
  const notesDialog = page.getByRole("dialog", {
    name: "更新内容",
    exact: true,
  });
  await notesDialog.waitFor();
  assert.deepEqual(
    await notesDialog.locator(".release-version h3").allTextContents(),
    ["v0.4.3", "v0.4.2"],
  );
  assert.match(await notesDialog.innerText(), /按版本展示更新说明/);
  assert.match(await notesDialog.innerText(), /更新说明 HTML 标签显示问题/);
  assert.doesNotMatch(await notesDialog.innerText(), /不应显示的旧版本/);
  assert.doesNotMatch(await notesDialog.innerText(), /<(h2|li|img|script)/i);
  assert.equal(await notesDialog.locator("img").count(), 0);
  await page.screenshot({ path: join(output, "release-notes-dialog.png") });
  await button("关闭更新内容").click();
  await notesDialog.waitFor({ state: "detached" });
  await app.evaluate(() => {
    globalThis.__updatesTest.releaseNotesFail = true;
  });
  await button("查看更新内容").click();
  await notesDialog.waitFor();
  assert.match(
    await notesDialog.innerText(),
    /暂时无法加载历史版本说明/,
  );
  assert.match(await notesDialog.innerText(), /票迹 v0\.4\.3/);
  assert.match(await notesDialog.innerText(), /• 批量核对/);
  assert.match(await notesDialog.innerText(), /Synthetic release notes/);
  await page.screenshot({
    path: join(output, "release-notes-fallback.png"),
  });
  await button("关闭更新内容").click();
  await notesDialog.waitFor({ state: "detached" });
  await page.screenshot({ path: join(output, "available.png"), fullPage: true });
  await button("下载更新").click();
  await button("安装更新并退出").waitFor();
  assert.equal(await app.evaluate(() => globalThis.__updatesTest.installs), 0);
  await button("安装更新并退出").click();
  await button("取消").click();
  assert.equal(await app.evaluate(() => globalThis.__updatesTest.installs), 0);
  await app.evaluate(() => { globalThis.__updatesTest.failPrepare = true; });
  await button("安装更新并退出").click();
  await button("退出并安装").click();
  await page.getByText("测试安装条件不满足，安装已停止。", { exact: true }).waitFor();
  assert.equal(await app.evaluate(() => globalThis.__updatesTest.installs), 0);
  await app.evaluate(() => { globalThis.__updatesTest.failPrepare = false; });
  await button("安装更新并退出").click();
  await button("退出并安装").click();
  await page.waitForFunction(() => document.body.textContent.includes("正在打开安装程序"));
  assert.equal(await app.evaluate(() => globalThis.__updatesTest.installs), 1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1000, 740));
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: join(output, "compact.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log("Update UI: disabled development mode, versioned release notes dialog and fallback, explicit download, cancel, blocked preparation, install and compact layout passed (simulated updater; no real installation).");
} finally {
  await app.close();
}
