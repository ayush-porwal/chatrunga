import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";
import { bumpVersion, nightlyVersion, releaseNotes } from "./release-plan.mjs";

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

test("a nightly is the next patch after the latest release, dated as a prerelease", () => {
  assert.equal(nightlyVersion("0.2.8", "0.2.8", "20261023"), "0.2.9-nightly.20261023");
  // No release yet: the package version, without its own prerelease part.
  assert.equal(nightlyVersion("", "0.1.0-alpha.3", "20261023"), "0.1.0-nightly.20261023");
  // After that patch is released, nightlies move on to the next one.
  assert.equal(nightlyVersion("0.2.9", "0.2.9", "20261024"), "0.2.10-nightly.20261024");
});

test("a nightly sorts after the previous one and before its patch's release", () => {
  // The release after nightlies of 0.2.9 is 0.2.9 itself (bumped from the stable 0.2.8).
  assert.equal(bumpVersion("0.2.8", "patch"), "0.2.9");
  assert.equal(bumpVersion("0.2.9-nightly.20261023", "patch"), "0.2.9");
});

test("a nightly refuses an exact version rather than ignoring it", () => {
  const run = spawnSync(
    process.execPath,
    [
      new URL("./release-plan.mjs", import.meta.url).pathname,
      "--channel",
      "nightly",
      "--version",
      "1.0.0"
    ],
    { encoding: "utf8" }
  );
  assert.equal(run.status, 1);
  assert.match(run.stderr, /set automatically/);
});
