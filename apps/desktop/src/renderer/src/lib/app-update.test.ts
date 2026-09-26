import { describe, expect, it } from "vitest";
import type { UpdateState, UpdateStatus } from "@chaturanga/shared/types/updates";
import {
  formatLastChecked,
  formatReleaseDate,
  inlineParts,
  parseReleaseNotes,
  updateAction,
  updateButtonView,
  updateCardAction,
  updateStatusText
} from "./app-update";

const state = (status: UpdateStatus, overrides: Partial<UpdateState> = {}): UpdateState => ({
  status,
  mode: "auto",
  currentVersion: "0.1.0",
  lastCheckedAt: null,
  autoDownload: true,
  allowPrerelease: false,
  modeReason: null,
  ...overrides
});

const manual: UpdateStatus = { kind: "manual", version: "0.2.0", notes: "", sizeBytes: null, releaseDate: null, url: "https://github.com/o/r/releases/tag/v0.2.0" };
const ready: UpdateStatus = { kind: "ready", version: "0.2.0", notes: "", releaseDate: null };
const downloading: UpdateStatus = { kind: "downloading", version: "0.2.0", notes: "", releaseDate: null, percent: 41.6, transferredBytes: 1, totalBytes: 2 };
const now = Date.UTC(2026, 8, 26, 12, 0, 0);

describe("updateButtonView", () => {
  it("checks for updates when there is nothing to offer", () => {
    expect(updateButtonView(null, null, now)).toMatchObject({ visual: "idle", label: "Check for updates", hasUpdate: false });
    expect(updateButtonView(state({ kind: "up-to-date" }, { lastCheckedAt: now - 5 * 60_000 }), null, now)).toMatchObject({
      visual: "idle",
      label: "Check for updates",
      detail: "Last checked 5 min ago"
    });
  });

  it("spins while checking and confirms a user-started check", () => {
    expect(updateButtonView(state({ kind: "checking" }), null, now).visual).toBe("checking");
    expect(updateButtonView(state({ kind: "up-to-date" }), "up-to-date", now)).toMatchObject({
      visual: "up-to-date",
      label: "You’re up to date · v0.1.0"
    });
  });

  it("shows errors briefly after a user check, then as the tooltip's detail", () => {
    const error = state({ kind: "error", message: "Couldn’t check for updates." });
    expect(updateButtonView(error, "error", now)).toMatchObject({ visual: "error", label: "Couldn’t check for updates." });
    expect(updateButtonView(error, null, now)).toMatchObject({ visual: "idle", detail: "Couldn’t check for updates." });
  });

  it("switches to the update's state once one exists", () => {
    expect(updateButtonView(state(manual, { mode: "manual" }), null, now)).toMatchObject({ visual: "update", hasUpdate: true, label: "Chaturanga v0.2.0 available" });
    expect(updateButtonView(state(downloading), null, now)).toMatchObject({ visual: "downloading", percent: 41.6, label: "Downloading v0.2.0 · 42%" });
    expect(updateButtonView(state(ready), null, now)).toMatchObject({ visual: "ready", label: "Update ready · v0.2.0" });
  });

  it("explains development builds", () => {
    expect(updateButtonView(state({ kind: "disabled", message: "x" }, { mode: "disabled" }), null, now)).toMatchObject({
      visual: "disabled",
      label: "Updates work in installed builds"
    });
  });
});

describe("actions and status text", () => {
  it("maps statuses to their one action", () => {
    expect(updateAction(ready)).toBe("install");
    expect(updateAction(manual)).toBe("open-download");
    expect(updateAction({ kind: "available", version: "0.2.0", notes: "", sizeBytes: 1, releaseDate: null })).toBe("download");
    expect(updateAction({ kind: "checking" })).toBeNull();
  });

  it("labels the changelog card's button", () => {
    expect(updateCardAction(ready)).toEqual({ label: "Restart to update", action: "install" });
    expect(updateCardAction(downloading)).toEqual({ label: "Downloading… 42%", action: null });
    expect(updateCardAction(manual)).toEqual({ label: "Download v0.2.0", action: "open-download" });
    expect(updateCardAction({ kind: "up-to-date" })).toBeNull();
  });

  it("describes every status in one line", () => {
    expect(updateStatusText(state({ kind: "checking" }))).toBe("Checking for updates…");
    expect(updateStatusText(state({ kind: "up-to-date" }))).toBe("Chaturanga is up to date.");
    expect(updateStatusText(state(downloading))).toBe("Downloading version 0.2.0… 42%");
    expect(updateStatusText(state(ready))).toMatch(/Restart/);
    expect(updateStatusText(state(manual))).toBe("Version 0.2.0 is available to download.");
    expect(updateStatusText(state({ kind: "error", message: "Couldn’t check for updates." }))).toBe("Couldn’t check for updates.");
    expect(updateStatusText(state({ kind: "idle" }))).toMatch(/automatically/);
  });
});

describe("dates", () => {
  it("reads relative check times", () => {
    expect(formatLastChecked(null, now)).toBe("Not checked yet");
    expect(formatLastChecked(now - 10_000, now)).toBe("Last checked just now");
    expect(formatLastChecked(now - 3 * 3_600_000, now)).toBe("Last checked 3 h ago");
    expect(formatLastChecked(now - 3 * 86_400_000, now)).toMatch(/^Last checked on /);
  });

  it("formats release dates and ignores bad ones", () => {
    expect(formatReleaseDate("2026-09-26T19:29:54.528Z")).toMatch(/2026/);
    expect(formatReleaseDate("nope")).toBeNull();
    expect(formatReleaseDate(null)).toBeNull();
  });
});

describe("release notes", () => {
  it("keeps http(s) links as links and drops other targets", () => {
    expect(inlineParts("see [the review](https://x.y/a) and [local](file:///etc) **now**")).toEqual([
      { text: "see " },
      { text: "the review", href: "https://x.y/a" },
      { text: " and local now" }
    ]);
    expect(inlineParts("[bad](javascript:alert(1))")).toEqual([{ text: "bad)" }]);
  });

  it("turns release-plan notes into headings, bullets and paragraphs", () => {
    const notes = [
      "## Chaturanga v0.2.0",
      "",
      "### Features",
      "",
      "- **updates:** in-app updates ([`abc1234`](https://github.com/o/r/commit/abc1234def))",
      "- faster [review](https://x.y) with `Stockfish`",
      "",
      "Some *extra* words",
      "on two lines.",
      "",
      "**Full changelog:** https://github.com/o/r/compare/v0.1.0...v0.2.0",
      "",
      "### Install",
      "",
      "- **macOS:** `.dmg`"
    ].join("\n");
    expect(parseReleaseNotes(notes)).toEqual([
      { type: "heading", text: "Features" },
      { type: "bullet", parts: [{ text: "updates: in-app updates" }] },
      { type: "bullet", parts: [{ text: "faster " }, { text: "review", href: "https://x.y" }, { text: " with Stockfish" }] },
      { type: "paragraph", parts: [{ text: "Some extra words on two lines." }] }
    ]);
  });

  it("keeps text that looks like markup as text", () => {
    expect(parseReleaseNotes("<img src=x onerror=alert(1)>")).toEqual([{ type: "paragraph", parts: [{ text: "<img src=x onerror=alert(1)>" }] }]);
    expect(parseReleaseNotes("")).toEqual([]);
  });
});
