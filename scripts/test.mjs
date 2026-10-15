import { build } from "esbuild";
import { spawnSync } from "node:child_process";
await build({
  entryPoints: [
    "tests/database.test.ts",
    "tests/backup.test.ts",
    "tests/messages.test.ts",
    "tests/updates.test.ts",
  ],
  bundle: true,
  platform: "node",
  format: "cjs",
  outdir: ".test-data/tests",
  outExtension: { ".js": ".cjs" },
  packages: "external",
});
const r = spawnSync(
  process.execPath,
  [
    "--test",
    ".test-data/tests/database.test.cjs",
    ".test-data/tests/backup.test.cjs",
    ".test-data/tests/messages.test.cjs",
    ".test-data/tests/updates.test.cjs",
  ],
  { stdio: "inherit" },
);
process.exit(r.status ?? 1);
