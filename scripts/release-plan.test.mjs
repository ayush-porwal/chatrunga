import assert from "node:assert/strict";
import { test } from "node:test";
import { bumpVersion, releaseNotes } from "./release-plan.mjs";

test("bumps stable versions", () => {
  assert.equal(bumpVersion("1.2.3", "patch"), "1.2.4");
  assert.equal(bumpVersion("1.2.3", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3", "major"), "2.0.0");
});

test("respects the requested level after a prerelease", () => {
  assert.equal(bumpVersion("0.9.0-beta.1", "major"), "1.0.0");
  assert.equal(bumpVersion("0.9.0-beta.1", "minor"), "0.9.0");
  assert.equal(bumpVersion("0.9.0-beta.1", "patch"), "0.9.0");
  assert.equal(bumpVersion("1.2.3-rc.1", "minor"), "1.3.0");
  assert.equal(bumpVersion("1.2.3-rc.1", "patch"), "1.2.3");
  assert.equal(bumpVersion("1.0.0-rc.1", "major"), "1.0.0");
});

test("groups commits by Conventional Commit type", () => {
  const notes = releaseNotes({
    version: "1.1.0",
    previousTag: "v1.0.0",
    repo: "owner/repo",
    commits: [
      { sha: "a".repeat(40), subject: "feat(ui): new board" },
      { sha: "b".repeat(40), subject: "fix: clock" },
      { sha: "c".repeat(40), subject: "Tidy things" }
    ]
  });
  assert.match(notes, /### Features\n\n- \*\*ui:\*\* new board/);
  assert.match(notes, /### Fixes\n\n- clock/);
  assert.match(notes, /### Other changes\n\n- Tidy things/);
  assert.match(notes, /compare\/v1\.0\.0\.\.\.v1\.1\.0/);
});
