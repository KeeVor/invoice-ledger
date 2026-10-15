import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { UpdateService } from "../electron/updates";
import type { UpdateState } from "../src/types";

class FakeUpdater extends EventEmitter {
  autoDownload = true;
  autoInstallOnAppQuit = true;
  allowPrerelease = true;
  allowDowngrade = true;
  disableWebInstaller = false;
  checks = 0;
  downloads = 0;
  installs = 0;
  checkForUpdates = async () => { this.checks++; };
  downloadUpdate = async () => { this.downloads++; this.emit("update-downloaded"); };
  quitAndInstall() { this.installs++; }
}
function fixture(enabled = true, prepare: () => Promise<boolean> = async () => true) {
  const adapter = new FakeUpdater();
  const changes: UpdateState[] = [];
  const service = new UpdateService(adapter, enabled, (s) => changes.push(s), prepare);
  return { adapter, service, changes };
}
async function available(f: ReturnType<typeof fixture>) {
  f.adapter.checkForUpdates = async () => {
    f.adapter.checks++;
    f.adapter.emit("update-available", { version: "0.3.1", releaseNotes: "<b>Plain text only</b>" });
  };
  await f.service.check();
}
test("updater requires explicit download and install and excludes prereleases/downgrades", () => {
  const { adapter } = fixture();
  assert.equal(adapter.autoDownload, false);
  assert.equal(adapter.autoInstallOnAppQuit, false);
  assert.equal(adapter.allowPrerelease, false);
  assert.equal(adapter.allowDowngrade, false);
  assert.equal(adapter.disableWebInstaller, true);
});
test("development and unpacked applications do not contact the update server", async () => {
  const { adapter, service } = fixture(false);
  await service.check(); await service.download(); await service.install();
  assert.equal(service.snapshot().status, "disabled");
  assert.equal(adapter.checks + adapter.downloads + adapter.installs, 0);
});
test("available update never downloads automatically and retains plain release notes", async () => {
  const f = fixture(); await available(f);
  assert.equal(f.service.snapshot().status, "available");
  assert.equal(f.service.snapshot().releaseNotes, "<b>Plain text only</b>");
  assert.equal(f.adapter.downloads, 0);
});
test("current version and network errors produce recoverable public states", async () => {
  const f = fixture();
  f.adapter.checkForUpdates = async () => { f.adapter.emit("update-not-available"); };
  await f.service.check();
  assert.equal(f.service.snapshot().status, "not-available");
  f.adapter.checkForUpdates = async () => { throw new Error("private token/path"); };
  await f.service.check();
  assert.equal(f.service.snapshot().status, "error");
  assert.doesNotMatch(f.service.snapshot().message!, /private|token/);
  await available(f);
  assert.equal(f.service.snapshot().status, "available");
});
test("duplicate checks and downloads are ignored while a request is in flight", async () => {
  const f = fixture();
  let finish!: () => void;
  f.adapter.checkForUpdates = () => { f.adapter.checks++; return new Promise<void>((r) => { finish = r; }); };
  const request = f.service.check(); await f.service.check();
  assert.equal(f.adapter.checks, 1);
  f.adapter.emit("update-available", { version: "0.3.1" }); finish(); await request;
  f.adapter.downloadUpdate = () => { f.adapter.downloads++; return new Promise<void>((r) => { finish = r; }); };
  const download = f.service.download(); await f.service.download(); await f.service.check();
  assert.equal(f.adapter.downloads, 1);
  f.adapter.emit("download-progress", { percent: 150 });
  assert.equal(f.service.snapshot().percent, 100);
  f.adapter.emit("update-downloaded"); finish(); await download;
  assert.equal(f.service.snapshot().status, "downloaded");
  assert.equal(f.adapter.installs, 0);
});
test("cancelled confirmation or failed preparation cannot launch the installer", async () => {
  const f = fixture(true, async () => false); await available(f); await f.service.download();
  await f.service.install();
  assert.equal(f.adapter.installs, 0);
  assert.equal(f.service.snapshot().status, "downloaded");
  const broken = fixture(true, async () => { throw new Error("installation blocked"); });
  await available(broken); await broken.service.download();
  await assert.rejects(broken.service.install(), /installation blocked/);
  assert.equal(broken.adapter.installs, 0);
  assert.equal(broken.service.snapshot().status, "downloaded");
});
test("confirmed preparation precedes installation and repeated install is ignored", async () => {
  let prepared = false;
  const f = fixture(true, async () => { prepared = true; return true; });
  await available(f); await f.service.download();
  f.adapter.quitAndInstall = () => { assert.equal(prepared, true); f.adapter.installs++; };
  await f.service.install(); await f.service.install();
  assert.equal(f.adapter.installs, 1);
  assert.equal(f.service.snapshot().status, "installing");
});
test("download errors allow a new check without exposing diagnostics", async () => {
  const f = fixture(); await available(f);
  f.adapter.downloadUpdate = async () => { f.adapter.emit("error", new Error("secret")); throw new Error("secret"); };
  await f.service.download();
  assert.equal(f.service.snapshot().status, "error");
  assert.doesNotMatch(f.service.snapshot().message!, /secret/);
  await available(f);
  assert.equal(f.service.snapshot().status, "available");
});
test("installer launch failure restores an actionable error state", async () => {
  const f = fixture(); await available(f); await f.service.download();
  f.adapter.quitAndInstall = () => { throw new Error("sensitive path"); };
  await f.service.install();
  assert.equal(f.service.snapshot().status, "error");
  assert.doesNotMatch(f.service.snapshot().message!, /sensitive/);
});
