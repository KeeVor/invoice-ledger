import fs from "node:fs/promises";
import { join } from "node:path";
const lock = JSON.parse(await fs.readFile("package-lock.json", "utf8"));
const entries = [];
for (const [path, pkg] of Object.entries(lock.packages)) {
  if (!path || pkg.dev) continue;
  const name = path.split("node_modules/").at(-1);
  let contents = "";
  try {
    for (const file of await fs.readdir(path)) {
      if (
        /^(licen[sc]e|notice|copying)(\.|$)/i.test(file) &&
        (await fs.stat(join(path, file))).isFile()
      )
        contents += `\n### ${file}\n\n${await fs.readFile(join(path, file), "utf8")}\n`;
    }
  } catch {}
  entries.push(
    `## ${name} ${pkg.version}\n\nDeclared license: ${pkg.license ?? "See package source"}\n${contents}`,
  );
}
await fs.writeFile(
  "THIRD_PARTY_NOTICES.md",
  "# Third-party notices\n\nGenerated from package-lock.json. Python and OCR model notices are distributed separately under resources/licenses. Electron includes its own LICENSE and LICENSES.chromium.html.\n\n" +
    entries.join("\n---\n\n"),
);
console.log(`Collected ${entries.length} production dependency notices`);
