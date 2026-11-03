import fs from "node:fs/promises";
import { join, resolve } from "node:path";

const root = resolve(".");
const sourceDir = join(root, "docs", "release-notes");
const packageInfo = JSON.parse(
  await fs.readFile(join(root, "package.json"), "utf8"),
);
const categoryNames = {
  新增: "added",
  修复: "fixed",
  行为变化: "changed",
};
const versionPattern = /^v?(\d+\.\d+\.\d+)\.md$/;

function compareVersions(left, right) {
  const a = left.split(".").map(Number);
  const b = right.split(".").map(Number);
  for (let index = 0; index < 3; index++) {
    if (a[index] !== b[index]) return a[index] - b[index];
  }
  return 0;
}

function cleanItem(value) {
  return value
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

async function readReleaseNote(file) {
  const match = versionPattern.exec(file);
  if (!match) return null;
  const version = match[1];
  const text = await fs.readFile(join(sourceDir, file), "utf8");
  const release = { version, added: [], fixed: [], changed: [] };
  let category = null;
  for (const line of text.split(/\r?\n/)) {
    const heading = /^###\s+(.+?)\s*$/.exec(line);
    if (heading) {
      category = categoryNames[heading[1]] ?? null;
      continue;
    }
    const item = /^\s*[-*]\s+(.+?)\s*$/.exec(line);
    if (!category || !item) continue;
    const value = cleanItem(item[1]);
    if (!value) continue;
    if (/<[a-z][^>]*>/i.test(value))
      throw new Error(`${file}: release note items must be plain text`);
    release[category].push(value);
  }
  if (!release.added.length && !release.fixed.length && !release.changed.length)
    throw new Error(`${file}: no release note items found`);
  return release;
}

async function releaseHistory() {
  const files = (await fs.readdir(sourceDir))
    .filter((file) => /^v?\d+\.\d+\.\d+\.md$/.test(file))
    .sort();
  const releases = [];
  for (const file of files) {
    const release = await readReleaseNote(file);
    if (
      release &&
      compareVersions(release.version, packageInfo.version) <= 0
    )
      releases.push(release);
  }
  releases.sort((a, b) => compareVersions(b.version, a.version));
  return { format: 1, releases };
}

async function main() {
  const action = process.argv[2] ?? "--check";
  if (!["--check", "--generate"].includes(action))
    throw new Error("Use --check or --generate");
  const current = join(sourceDir, `v${packageInfo.version}.md`);
  await fs.access(current).catch(() => {
    throw new Error(
      `Missing release note file for v${packageInfo.version}: ${current}`,
    );
  });
  const history = await releaseHistory();
  if (
    history.releases[0]?.version !== packageInfo.version
  )
    throw new Error(
      `Release notes do not start with package version ${packageInfo.version}`,
    );
  if (action === "--check") {
    console.log(
      `Release notes valid for v${packageInfo.version}: ${history.releases.length} version(s)`,
    );
    return;
  }
  const output = join(root, "release", "current", "release-notes.json");
  await fs.mkdir(join(root, "release", "current"), { recursive: true });
  await fs.writeFile(output, `${JSON.stringify(history, null, 2)}\n`);
  console.log(`Wrote ${output}`);
}

await main();
