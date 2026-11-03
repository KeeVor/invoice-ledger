import fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join } from "node:path";
import assert from "node:assert/strict";
import { load } from "js-yaml";

const { version } = JSON.parse(await fs.readFile("package.json", "utf8"));
const root = "release/current";
const name = `Piaoji-Setup-${version}.exe`;
const info = load(await fs.readFile(join(root, "latest.yml"), "utf8"));
assert.equal(info.version, version);
assert.equal(info.path, name);
const entry = info.files.find((file) => file.url === name);
assert.ok(entry, "Installer missing from update manifest");
assert.equal(entry.size, (await fs.stat(join(root, name))).size);
const sha512 = createHash("sha512");
const sha256 = createHash("sha256");
for await (const data of createReadStream(join(root, name))) {
  sha512.update(data);
  sha256.update(data);
}
const digest = sha512.digest("base64");
assert.equal(entry.sha512, digest);
assert.equal(info.sha512, digest);
assert.ok((await fs.stat(join(root, `${name}.blockmap`))).size > 0);
const notes = JSON.parse(
  await fs.readFile(join(root, "release-notes.json"), "utf8"),
);
assert.equal(notes.format, 1);
assert.ok(Array.isArray(notes.releases) && notes.releases.length);
assert.equal(notes.releases[0].version, version);
for (const release of notes.releases) {
  assert.match(release.version, /^\d+\.\d+\.\d+$/);
  for (const items of [release.added, release.fixed, release.changed]) {
    assert.ok(Array.isArray(items));
    for (const item of items) {
      assert.equal(typeof item, "string");
      assert.ok(item.trim());
      assert.doesNotMatch(item, /<[a-z][^>]*>/i);
    }
  }
}
await fs.writeFile(join(root, "SHA256SUMS.txt"), `${sha256.digest("hex")}  ${name}\n`);
console.log(
  `Release ${version}: installer, update metadata and ${notes.releases.length} version note file(s) verified`,
);
