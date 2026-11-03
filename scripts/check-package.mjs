import { _electron as electron } from "playwright-core";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import { resolve, join } from "node:path";
import assert from "node:assert/strict";
import { extractFile } from "@electron/asar";

const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const packageRoot = resolve(
  process.env.PACKAGE_DIR || "release/current/win-unpacked",
);
const executable = join(packageRoot, "票迹.exe");
const worker = resolve(packageRoot, "resources", "ocr", "invoice-worker.exe");
const env = {
  ...process.env,
  PATH: `${process.env.SystemRoot}\\System32`,
  PYTHONPATH: "",
  PYTHONHOME: "",
};
delete env.ELECTRON_RUN_AS_NODE;
await fs.mkdir(resolve("output"), { recursive: true });
const workerOnly = process.argv.includes("--worker-only");
const archive = join(packageRoot, "resources", "app.asar");
assert.equal(
  JSON.parse(extractFile(archive, "package.json").toString()).version,
  version,
);
for (const name of [
  "dist/index.html",
  "dist-electron/main.cjs",
  "dist-electron/preload.cjs",
  "build/icon.ico",
]) {
  assert.deepEqual(extractFile(archive, name), await fs.readFile(name));
}
for (const name of await fs.readdir("dist/assets")) {
  assert.deepEqual(
    extractFile(archive, join("dist", "assets", name)),
    await fs.readFile(join("dist/assets", name)),
  );
}
console.log("Packaged source, UI assets and fonts: matched current build");
if (!workerOnly) {
  const application = await electron.launch({
    executablePath: executable,
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
    await page
      .getByRole("heading", { name: "发票台账", exact: true })
      .waitFor();
    const info = await page.evaluate(() => window.ledger.info());
    assert.equal(info.version, version);
    assert.equal(info.engine, true);
    assert.equal(
      await page.evaluate(() => navigator.windowControlsOverlay.visible),
      true,
    );
    assert.equal(await page.locator(".breadcrumb, .user-avatar").count(), 0);
    const stats = await page.evaluate(() => window.ledger.stats());
    const dbInfo = await application.evaluate(({ app }) => ({
      packaged: app.isPackaged,
      appPath: app.getAppPath(),
      userData: app.getPath("userData"),
    }));
    assert.equal(dbInfo.packaged, true);
    assert.equal(dbInfo.appPath, join(packageRoot, "resources", "app.asar"));
    assert.deepEqual(errors, []);
    await page.screenshot({ path: resolve("output", "packaged-app.png") });
    console.log(
      JSON.stringify(
        {
          packagedBoot: "passed",
          ...dbInfo,
          engine: info.engine,
          nativeTitlebarOverlay: true,
          count: stats.count,
        },
        null,
        2,
      ),
    );
  } finally {
    await application.close();
  }
} else {
  console.log(
    "Packaged app boot: skipped (--worker-only); close the existing app before a full run",
  );
}

const samples = [process.env.SAMPLE_PDF, process.env.SAMPLE_IMAGE].filter(
  Boolean,
);
assert.equal(samples.length, 2, "Set SAMPLE_PDF and SAMPLE_IMAGE");
for (let i = 0; i < samples.length; i++) {
  const request = {
    id: String(i),
    path: samples[i],
    outputDir: resolve("output", `packaged-recognition-${i}`),
  };
  const result = await new Promise((resolveResult, reject) => {
    const child = spawn(worker, [], { env, windowsHide: true });
    let stdout = "",
      stderr = "";
    const timeout = setTimeout(() => {
      child.kill();
      reject(new Error("Packaged OCR timeout"));
    }, 120000);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (data) => {
      stdout += data;
    });
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      clearTimeout(timeout);
      code === 0
        ? resolveResult(JSON.parse(stdout))
        : reject(new Error(stderr));
    });
    child.stdin.end(JSON.stringify(request) + "\n");
  });
  assert.equal(result.error, undefined);
  assert.equal(
    result.results[0].invoiceNumber,
    i === 0 ? "20000000000000000001" : "20000000000000000101",
  );
  assert.equal(result.results[0].totalCents, i === 0 ? 1300949 : 4341170);
  console.log(`Packaged OCR ${i === 0 ? "PDF" : "image"}: passed`);
}
await fs.writeFile(
  resolve("output", "packaged-results.json"),
  JSON.stringify(
    {
      passed: true,
      packagedBoot: workerOnly ? "not-tested" : "passed",
      scope: `${workerOnly ? "Packaged resource verification" : "Packaged app startup + SQLite access"} + standalone worker PDF and image recognition; PATH excludes Python and Node. Not a clean-machine installer test.`,
    },
    null,
    2,
  ),
);
