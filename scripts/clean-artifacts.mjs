import fs from "node:fs/promises";
import { resolve, sep } from "node:path";

const root = resolve(".");
function inside(path) {
  const target = resolve(root, path);
  if (target === root || !target.startsWith(`${root}${sep}`))
    throw new Error(`Refusing to remove path outside the workspace: ${target}`);
  return target;
}
async function remove(path) {
  const target = inside(path);
  await fs.rm(target, { recursive: true, force: true });
  console.log(`Removed ${target}`);
}
async function cleanTestData() {
  const data = inside(".test-data");
  let entries;
  try {
    entries = await fs.readdir(data, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (entry.name === "synthetic-samples") continue;
    await remove(`.test-data/${entry.name}`);
  }
}
async function cleanRelease({ keepCurrent = false } = {}) {
  const release = inside("release");
  let entries;
  try {
    entries = await fs.readdir(release, { withFileTypes: true });
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const entry of entries) {
    if (
      entry.isDirectory() &&
      ((entry.name === "current" && !keepCurrent) || /^v\d/.test(entry.name))
    )
      await remove(`release/${entry.name}`);
  }
}
async function cleanBuild() {
  await cleanRelease();
  for (const path of ["dist", "dist-electron", "python-build", "python-dist"])
    await remove(path);
}
async function preserveLatestAndCleanLegacy() {
  const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
  const source = inside(`release/v${version}`);
  const target = inside("release/current");
  if (await fs.stat(source).then(() => true, () => false)) {
    await fs.mkdir(target, { recursive: true });
    for (const name of await fs.readdir(source)) {
      if (
        !/^(Piaoji-Setup-.*\.exe|Piaoji-Setup-.*\.exe\.blockmap|latest\.yml|SHA256SUMS\.txt)$/.test(
          name,
        )
      )
        continue;
      await fs.copyFile(
        inside(`release/v${version}/${name}`),
        inside(`release/current/${name}`),
      );
    }
  }
  await cleanRelease({ keepCurrent: true });
  await remove("python-build");
}

const args = new Set(process.argv.slice(2));
if (args.has("--test")) await cleanTestData();
if (args.has("--build")) await cleanBuild();
if (args.has("--release-before")) {
  await cleanRelease();
  await remove("python-build");
  await remove("python-dist");
}
if (args.has("--release-after")) {
  await remove("release/current/win-unpacked");
  await remove("python-build");
  await remove("python-dist");
}
if (args.has("--release-dir-after")) {
  await remove("python-build");
  await remove("python-dist");
}
if (args.has("--legacy")) {
  await preserveLatestAndCleanLegacy();
  await cleanTestData();
}
if (!args.size) {
  console.log(
    "Usage: node scripts/clean-artifacts.mjs [--test] [--build] [--release-before] [--release-after] [--release-dir-after] [--legacy]",
  );
  process.exitCode = 1;
}
