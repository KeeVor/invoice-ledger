import { test } from "node:test";
import assert from "node:assert/strict";
import {
  compareVersions,
  releaseNotesForUpdate,
} from "../src/releaseNotes";
import type { ReleaseNotesHistory } from "../src/types";

const release = (version: string) => ({
  version,
  added: [`新增 ${version}`],
  fixed: [],
  changed: [],
});

test("release versions compare numerically", () => {
  assert.equal(compareVersions("0.4.2", "0.4.10"), -8);
  assert.equal(compareVersions("v0.5.0", "0.4.9"), 1);
  assert.equal(compareVersions("broken", "0.4.1"), 0);
});

test("update history only includes versions on the upgrade path", () => {
  const history: ReleaseNotesHistory = {
    format: 1,
    releases: [
      release("0.5.0"),
      release("0.4.2"),
      release("0.4.1"),
      release("0.4.0"),
      release("0.3.0"),
      { ...release("invalid"), version: "invalid" },
    ],
  };
  assert.deepEqual(
    releaseNotesForUpdate(history, "0.3.0", "0.4.2").map(
      (item) => item.version,
    ),
    ["0.4.2", "0.4.1", "0.4.0"],
  );
});

test("already-current or unavailable history produces no rows", () => {
  const history: ReleaseNotesHistory = {
    format: 1,
    releases: [release("0.4.1"), release("0.4.2")],
  };
  assert.deepEqual(releaseNotesForUpdate(history, "0.4.2", "0.4.2"), []);
  assert.deepEqual(releaseNotesForUpdate(undefined, "0.3.0", "0.4.2"), []);
});
