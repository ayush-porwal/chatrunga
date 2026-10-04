import { spawnSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { UpdateStatus } from "@chaturanga/shared/types/updates";
import {
  BUNDLE_SWAP_SCRIPT,
  CHECK_FAILED_MESSAGE,
  DEV_BUILD_MESSAGE,
  isAllowedDownloadUrl,
  isCheckBlocked,
  isDeveloperIdSigned,
  isPrereleaseVersion,
  isSwappableBundlePath,
  MAC_NOT_REPLACEABLE_MESSAGE,
  macUpdateZip,
  manualDownloadUrl,
  parseAppUpdateConfig,
  readableUpdateError,
  reduceUpdateStatus,
  releaseNotesToText,
  releasePageUrl,
  resolveUpdateMode,
  shouldAllowPrerelease,
  swapResult,
  type UpdateEnvironment,
  type UpdateFeedConfig
} from "./updater-state";

const env = (overrides: Partial<UpdateEnvironment>): UpdateEnvironment => ({
  isPackaged: true,
  platform: "win32",
  appImage: undefined,
  macSigned: false,
  ...overrides
});

const github: UpdateFeedConfig = { provider: "github", owner: "ayush-porwal", repo: "chatrunga" };

/** What electron-builder's latest-mac.yml lists for our artifactName (both arches, zip + dmg). */
const macFiles = [
  { url: "Chaturanga-0.2.0-mac-arm64.zip", size: 110 },
  { url: "Chaturanga-0.2.0-mac-arm64.dmg", size: 120 },
  { url: "Chaturanga-0.2.0-mac-x64.zip", size: 130 },
  { url: "Chaturanga-0.2.0-mac-x64.dmg", size: 140 }
];

describe("resolveUpdateMode", () => {
  it("disables updates in development builds on every platform", () => {
    for (const platform of ["win32", "darwin", "linux"] as const) {
      expect(
        resolveUpdateMode(env({ isPackaged: false, platform, macSigned: true, appImage: "/a" }))
      ).toEqual({
        mode: "disabled",
        reason: DEV_BUILD_MESSAGE,
        bundleSwap: false
      });
    }
  });

  it("updates Windows automatically", () => {
    expect(resolveUpdateMode(env({ platform: "win32" })).mode).toBe("auto");
  });

  it("updates signed macOS builds through electron-updater", () => {
    expect(resolveUpdateMode(env({ platform: "darwin", macSigned: true }))).toEqual({
      mode: "auto",
      reason: null,
      bundleSwap: false
    });
  });

  it("updates unsigned macOS builds in place by swapping the bundle", () => {
    expect(
      resolveUpdateMode(env({ platform: "darwin", macSigned: false, macBundleReplaceable: true }))
    ).toEqual({
      mode: "auto",
      reason: null,
      bundleSwap: true
    });
  });

  it("asks unsigned macOS builds that can't be replaced to move to Applications", () => {
    expect(
      resolveUpdateMode(env({ platform: "darwin", macSigned: false, macBundleReplaceable: false }))
    ).toEqual({
      mode: "manual",
      reason: MAC_NOT_REPLACEABLE_MESSAGE,
      bundleSwap: false
    });
  });

  it("updates Linux automatically only inside an AppImage", () => {
    expect(
      resolveUpdateMode(env({ platform: "linux", appImage: "/home/me/Chaturanga.AppImage" })).mode
    ).toBe("auto");
    expect(resolveUpdateMode(env({ platform: "linux" })).mode).toBe("manual");
  });

  it("falls back to manual downloads on other platforms", () => {
    expect(resolveUpdateMode(env({ platform: "freebsd" })).mode).toBe("manual");
  });
});

describe("isDeveloperIdSigned", () => {
  it("rejects ad-hoc signatures (our current builds)", () => {
    const adhoc =
      "Executable=/Applications/Chaturanga.app/Contents/MacOS/Chaturanga\nSignature=adhoc\nTeamIdentifier=not set\n";
    expect(isDeveloperIdSigned(adhoc)).toBe(false);
  });

  it("rejects output without a team", () => {
    expect(isDeveloperIdSigned("TeamIdentifier=not set")).toBe(false);
    expect(isDeveloperIdSigned("code object is not signed at all")).toBe(false);
    expect(isDeveloperIdSigned("")).toBe(false);
  });

  it("accepts a Developer ID signature with a team identifier", () => {
    const signed =
      "Authority=Developer ID Application: Someone (ABCDE12345)\nTeamIdentifier=ABCDE12345\nRuntime Version=15.0.0\n";
    expect(isDeveloperIdSigned(signed)).toBe(true);
  });
});

describe("prerelease handling", () => {
  it("recognises prerelease versions", () => {
    expect(isPrereleaseVersion("0.2.0-beta.1")).toBe(true);
    expect(isPrereleaseVersion("v1.0.0-rc.2")).toBe(true);
    expect(isPrereleaseVersion("0.2.0")).toBe(false);
  });

  it("offers prereleases only to a build that is one (production stays on production)", () => {
    expect(shouldAllowPrerelease("0.2.0")).toBe(false);
    expect(shouldAllowPrerelease("0.3.0-nightly.2")).toBe(true);
  });
});

describe("parseAppUpdateConfig", () => {
  it("reads the GitHub feed electron-builder writes from build.publish", () => {
    const yml =
      "owner: ayush-porwal\nrepo: chatrunga\nprovider: github\nreleaseType: release\nupdaterCacheDirName: chaturanga-desktop-updater\n";
    expect(parseAppUpdateConfig(yml)).toEqual(github);
  });

  it("reads a generic feed and strips quotes", () => {
    expect(parseAppUpdateConfig("provider: generic\nurl: 'https://example.com/updates'\n")).toEqual(
      {
        provider: "generic",
        url: "https://example.com/updates"
      }
    );
  });

  it("returns null for incomplete or unknown feeds", () => {
    expect(parseAppUpdateConfig("provider: github\nowner: someone\n")).toBeNull();
    expect(parseAppUpdateConfig("provider: s3\nbucket: b\n")).toBeNull();
    expect(parseAppUpdateConfig("")).toBeNull();
  });
});

describe("manualDownloadUrl", () => {
  const update = { version: "0.2.0", files: macFiles };

  it("picks the DMG for the running CPU on macOS", () => {
    expect(manualDownloadUrl(github, update, { platform: "darwin", arch: "arm64" })).toBe(
      "https://github.com/ayush-porwal/chatrunga/releases/download/v0.2.0/Chaturanga-0.2.0-mac-arm64.dmg"
    );
    expect(manualDownloadUrl(github, update, { platform: "darwin", arch: "x64" })).toBe(
      "https://github.com/ayush-porwal/chatrunga/releases/download/v0.2.0/Chaturanga-0.2.0-mac-x64.dmg"
    );
  });

  it("falls back to the ZIP, then the release page", () => {
    const zipOnly = {
      version: "0.2.0",
      files: macFiles.filter((file) => file.url.endsWith(".zip"))
    };
    expect(manualDownloadUrl(github, zipOnly, { platform: "darwin", arch: "arm64" })).toMatch(
      /mac-arm64\.zip$/
    );
    expect(
      manualDownloadUrl(
        github,
        { version: "0.2.0", files: [] },
        { platform: "darwin", arch: "arm64" }
      )
    ).toBe("https://github.com/ayush-porwal/chatrunga/releases/tag/v0.2.0");
  });

  it("picks the AppImage on Linux", () => {
    const linux = {
      version: "0.2.0",
      files: [{ url: "Chaturanga-0.2.0-linux-x86_64.AppImage", size: 1 }]
    };
    expect(manualDownloadUrl(github, linux, { platform: "linux", arch: "x64" })).toMatch(
      /linux-x86_64\.AppImage$/
    );
  });

  it("resolves files against a generic (test override) feed", () => {
    const feed: UpdateFeedConfig = { provider: "generic", url: "http://127.0.0.1:8123/feed" };
    expect(manualDownloadUrl(feed, update, { platform: "darwin", arch: "arm64" }, feed.url)).toBe(
      "http://127.0.0.1:8123/feed/Chaturanga-0.2.0-mac-arm64.dmg"
    );
    expect(releasePageUrl(feed, "0.2.0")).toBe("http://127.0.0.1:8123/feed");
  });

  it("never offers a link openDownload() would refuse: installers on other hosts fall back to the release page", () => {
    const elsewhere = {
      version: "0.2.0",
      files: [{ url: "https://cdn.example.com/Chaturanga-arm64.dmg" }]
    };
    const url = manualDownloadUrl(github, elsewhere, { platform: "darwin", arch: "arm64" });
    expect(url).toBe("https://github.com/ayush-porwal/chatrunga/releases/tag/v0.2.0");
    expect(isAllowedDownloadUrl(url, null)).toBe(true);
    // Same for a generic-feed file on a different origin than the override.
    const feed: UpdateFeedConfig = { provider: "generic", url: "http://127.0.0.1:8123/feed" };
    const offOrigin = manualDownloadUrl(
      feed,
      elsewhere,
      { platform: "darwin", arch: "arm64" },
      feed.url
    );
    expect(offOrigin).toBe(feed.url);
    expect(isAllowedDownloadUrl(offOrigin, feed.url)).toBe(true);
  });
});

describe("isAllowedDownloadUrl", () => {
  it("allows https GitHub release links only", () => {
    expect(
      isAllowedDownloadUrl("https://github.com/ayush-porwal/chatrunga/releases/tag/v0.2.0", null)
    ).toBe(true);
    expect(isAllowedDownloadUrl("http://github.com/x", null)).toBe(false);
    expect(isAllowedDownloadUrl("https://github.com.evil.example/x", null)).toBe(false);
    expect(isAllowedDownloadUrl("file:///etc/passwd", null)).toBe(false);
    expect(isAllowedDownloadUrl("not a url", null)).toBe(false);
  });

  it("allows the test feed's origin when the override is set", () => {
    const feed = "http://127.0.0.1:8123/feed/";
    expect(isAllowedDownloadUrl("http://127.0.0.1:8123/feed/Chaturanga.dmg", feed)).toBe(true);
    expect(isAllowedDownloadUrl("http://127.0.0.1:9999/other", feed)).toBe(false);
  });
});

describe("releaseNotesToText", () => {
  it("keeps Markdown as is", () => {
    expect(releaseNotesToText("## Chaturanga v0.2.0\n\n- feat: updates\n")).toBe(
      "## Chaturanga v0.2.0\n\n- feat: updates"
    );
  });

  it("flattens GitHub's HTML release body without keeping any markup", () => {
    const html =
      '<h2>Chaturanga v0.2.0</h2>\n<h3>Features</h3>\n<ul>\n<li>In-app <strong>updates</strong> (<a href="https://x">#12</a>)</li>\n<li>Faster &amp; smaller</li>\n</ul><script>alert(1)</script><p>Thanks&#39;s &#x2764;</p>';
    const text = releaseNotesToText(html);
    expect(text).toContain("### Chaturanga v0.2.0");
    expect(text).toContain("### Features");
    expect(text).toContain("- In-app updates ([#12](https://x))");
    expect(text).toContain("- Faster & smaller");
    expect(text).toContain("Thanks's ❤");
    expect(text).not.toMatch(/<|alert/);
  });

  it("joins per-version notes and handles empty input", () => {
    expect(
      releaseNotesToText([
        { version: "0.2.0", note: "- a" },
        { version: "0.1.9", note: null }
      ])
    ).toBe("### 0.2.0\n\n- a");
    expect(releaseNotesToText(null)).toBe("");
    expect(releaseNotesToText(undefined)).toBe("");
  });
});

describe("readableUpdateError", () => {
  it("reads offline failures as a quiet check failure", () => {
    expect(readableUpdateError(new Error("net::ERR_INTERNET_DISCONNECTED"), "check")).toBe(
      `${CHECK_FAILED_MESSAGE}: you appear to be offline.`
    );
    expect(readableUpdateError(new Error("getaddrinfo ENOTFOUND github.com"), "check")).toMatch(
      /offline/
    );
  });

  it("reads a missing or private release feed (404) without the raw HTTP dump", () => {
    const message = readableUpdateError(
      new Error(
        'HttpError: 404 \n"method: GET url: https://github.com/ayush-porwal/chatrunga/releases.atom\\n\\n Please double check…"\nHeaders: {…}'
      ),
      "check"
    );
    expect(message).toBe(`${CHECK_FAILED_MESSAGE}: no published release was found.`);
  });

  it("reads a repo without a production release (only prereleases) as no published release", () => {
    const message = readableUpdateError(
      new Error(
        "Unable to find latest version on GitHub (https://github.com/o/r/releases/latest), please ensure a production release exists: HttpError: 406"
      ),
      "check"
    );
    expect(message).toBe(`${CHECK_FAILED_MESSAGE}: no published release was found.`);
  });

  it("covers rate limits, timeouts, checksums and unknown errors", () => {
    expect(readableUpdateError(new Error("HttpError: 403 rate limit exceeded"), "check")).toMatch(
      /GitHub refused/
    );
    expect(readableUpdateError(new Error("ETIMEDOUT"), "check")).toMatch(/timed out/);
    expect(readableUpdateError(new Error("sha512 checksum mismatch"), "download")).toBe(
      "Couldn’t download the update: the download was corrupted."
    );
    expect(readableUpdateError("weird", "install")).toBe("Couldn’t install the update.");
    expect(readableUpdateError(undefined, "check")).toBe(`${CHECK_FAILED_MESSAGE}.`);
  });
});

describe("reduceUpdateStatus", () => {
  const info = {
    version: "0.2.0",
    files: [{ url: "a.zip", size: 1234 }],
    releaseNotes: "- new",
    releaseDate: "2026-09-01T00:00:00Z"
  };
  const idle: UpdateStatus = { kind: "idle" };

  it("walks the automatic path: checking → available → downloading → ready", () => {
    let status = reduceUpdateStatus(idle, { type: "checking" });
    expect(status).toEqual({ kind: "checking" });
    status = reduceUpdateStatus(status, { type: "available", info, manualUrl: null });
    expect(status).toEqual({
      kind: "available",
      version: "0.2.0",
      notes: "- new",
      sizeBytes: 1234,
      releaseDate: "2026-09-01T00:00:00Z"
    });
    status = reduceUpdateStatus(status, { type: "download-started" });
    expect(status).toMatchObject({
      kind: "downloading",
      version: "0.2.0",
      percent: 0,
      totalBytes: 1234
    });
    status = reduceUpdateStatus(status, {
      type: "progress",
      percent: 142,
      transferred: 900,
      total: 1234
    });
    expect(status).toMatchObject({ kind: "downloading", percent: 100, transferredBytes: 900 });
    status = reduceUpdateStatus(status, { type: "downloaded", info });
    expect(status).toEqual({
      kind: "ready",
      version: "0.2.0",
      notes: "- new",
      releaseDate: "2026-09-01T00:00:00Z"
    });
  });

  it("takes the manual path when a download URL is given (unsigned macOS)", () => {
    const status = reduceUpdateStatus(
      { kind: "checking" },
      { type: "available", info, manualUrl: "https://github.com/o/r/releases/tag/v0.2.0" }
    );
    expect(status).toMatchObject({
      kind: "manual",
      version: "0.2.0",
      url: "https://github.com/o/r/releases/tag/v0.2.0",
      sizeBytes: null
    });
    const dmg = reduceUpdateStatus(
      { kind: "checking" },
      {
        type: "available",
        info: { version: "0.2.0", files: macFiles },
        manualUrl: "https://github.com/o/r/releases/download/v0.2.0/Chaturanga-0.2.0-mac-arm64.dmg"
      }
    );
    expect(dmg).toMatchObject({ kind: "manual", sizeBytes: 120 });
    // Progress events can't apply to a manual update.
    expect(
      reduceUpdateStatus(status, { type: "progress", percent: 50, transferred: 1, total: 2 })
    ).toBe(status);
  });

  it("reports up to date", () => {
    expect(reduceUpdateStatus({ kind: "checking" }, { type: "not-available" })).toEqual({
      kind: "up-to-date"
    });
  });

  it("never loses a downloaded update to later checks or failures", () => {
    const ready: UpdateStatus = { kind: "ready", version: "0.2.0", notes: "", releaseDate: null };
    expect(reduceUpdateStatus(ready, { type: "checking" })).toBe(ready);
    expect(reduceUpdateStatus(ready, { type: "not-available" })).toBe(ready);
    expect(reduceUpdateStatus(ready, { type: "available", info, manualUrl: null })).toBe(ready);
    expect(reduceUpdateStatus(ready, { type: "error", error: new Error("offline") })).toBe(ready);
    // A newer version than the downloaded one is offered again.
    expect(
      reduceUpdateStatus(ready, {
        type: "available",
        info: { ...info, version: "0.3.0" },
        manualUrl: null
      }).kind
    ).toBe("available");
  });

  it("turns failures into readable errors for the phase they happened in", () => {
    expect(
      reduceUpdateStatus(
        { kind: "checking" },
        { type: "error", error: new Error("net::ERR_NAME_NOT_RESOLVED") }
      )
    ).toEqual({
      kind: "error",
      message: `${CHECK_FAILED_MESSAGE}: you appear to be offline.`
    });
    const downloading: UpdateStatus = {
      kind: "downloading",
      version: "0.2.0",
      notes: "",
      releaseDate: null,
      percent: 10,
      transferredBytes: 1,
      totalBytes: 10
    };
    expect(reduceUpdateStatus(downloading, { type: "error", error: new Error("boom") })).toEqual({
      kind: "error",
      message: "Couldn’t download the update."
    });
  });

  it("ignores everything while disabled", () => {
    const disabled: UpdateStatus = { kind: "disabled", message: DEV_BUILD_MESSAGE };
    expect(reduceUpdateStatus(disabled, { type: "checking" })).toBe(disabled);
    expect(reduceUpdateStatus(disabled, { type: "available", info, manualUrl: null })).toBe(
      disabled
    );
  });

  it("blocks new checks while one is running, downloading, ready or disabled", () => {
    expect(isCheckBlocked({ kind: "checking" })).toBe(true);
    expect(isCheckBlocked({ kind: "ready", version: "1", notes: "", releaseDate: null })).toBe(
      true
    );
    expect(isCheckBlocked({ kind: "disabled", message: "" })).toBe(true);
    expect(isCheckBlocked({ kind: "up-to-date" })).toBe(false);
    expect(isCheckBlocked({ kind: "error", message: "" })).toBe(false);
  });
});

describe("isSwappableBundlePath", () => {
  it("accepts an installed bundle and rejects translocated or non-bundle paths", () => {
    expect(isSwappableBundlePath("/Applications/Chaturanga.app")).toBe(true);
    expect(isSwappableBundlePath("/Users/me/Applications/Chaturanga.app")).toBe(true);
    expect(
      isSwappableBundlePath("/private/var/folders/x/AppTranslocation/ABC/d/Chaturanga.app")
    ).toBe(false);
    expect(isSwappableBundlePath("/usr/local/bin")).toBe(false);
  });
});

describe("macUpdateZip", () => {
  const files = macFiles.map((file) => ({ ...file, sha512: `sha-${file.url}` }));
  const update = { version: "0.2.0", files };

  it("picks the release ZIP for this CPU with its checksum", () => {
    expect(macUpdateZip(github, update, "arm64")).toEqual({
      url: "https://github.com/ayush-porwal/chatrunga/releases/download/v0.2.0/Chaturanga-0.2.0-mac-arm64.zip",
      sha512: "sha-Chaturanga-0.2.0-mac-arm64.zip",
      size: 110
    });
    expect(macUpdateZip(github, update, "x64")?.url).toMatch(/mac-x64\.zip$/);
  });

  it("returns null without a checksummed ZIP or for a host outside the allow-list", () => {
    expect(macUpdateZip(github, { version: "0.2.0", files: macFiles }, "arm64")).toBeNull();
    expect(
      macUpdateZip(
        github,
        { version: "0.2.0", files: [{ url: "https://evil.example/a-arm64.zip", sha512: "x" }] },
        "arm64"
      )
    ).toBeNull();
  });

  it("resolves ZIPs against a test feed", () => {
    const feed: UpdateFeedConfig = { provider: "generic", url: "http://127.0.0.1:8123/feed" };
    expect(macUpdateZip(feed, update, "arm64", "http://127.0.0.1:8123/feed")?.url).toBe(
      "http://127.0.0.1:8123/feed/Chaturanga-0.2.0-mac-arm64.zip"
    );
  });
});

describe("BUNDLE_SWAP_SCRIPT", () => {
  /** A fake installed bundle and a staged replacement, marked by their contents. */
  function fixture() {
    const root = mkdtempSync(join(tmpdir(), "chaturanga-swap-"));
    const target = join(root, "Applications", "Chaturanga.app");
    const staged = join(root, "pending-update", "Chaturanga.app");
    for (const [bundle, version] of [
      [target, "old"],
      [staged, "new"]
    ] as const) {
      mkdirSync(join(bundle, "Contents"), { recursive: true });
      writeFileSync(join(bundle, "Contents", "version"), version);
    }
    const script = join(root, "swap.sh");
    writeFileSync(script, BUNDLE_SWAP_SCRIPT);
    return { root, target, staged, script };
  }

  // A pid that has already exited: the script shouldn't wait for it.
  const deadPid = () => String(spawnSync("/usr/bin/true").pid);

  it("replaces the bundle once the app has exited and removes the backup", () => {
    const { target, staged, script } = fixture();
    const result = spawnSync("/bin/sh", [script, deadPid(), target, staged, "0"], {
      encoding: "utf8"
    });
    expect(result.stdout.trim()).toBe("installed");
    expect(readFileSync(join(target, "Contents", "version"), "utf8")).toBe("new");
    expect(existsSync(staged)).toBe(false);
    expect(readdirSync(join(target, ".."))).toEqual(["Chaturanga.app"]);
  });

  it("leaves the app untouched when the new version can't be staged next to it", () => {
    const { root, target, script } = fixture();
    const result = spawnSync(
      "/bin/sh",
      [script, deadPid(), target, join(root, "missing.app"), "0"],
      { encoding: "utf8" }
    );
    expect(result.stdout.trim()).toBe("failed: could not copy the new version next to the app");
    expect(readFileSync(join(target, "Contents", "version"), "utf8")).toBe("old");
    expect(readdirSync(join(target, ".."))).toEqual(["Chaturanga.app"]);
  });

  it("isn't confused by leftovers from an earlier run", () => {
    const { target, staged, script } = fixture();
    mkdirSync(`${target}.previous-version`, { recursive: true });
    mkdirSync(`${target}.incoming-1`, { recursive: true });
    const result = spawnSync("/bin/sh", [script, deadPid(), target, staged, "0"], {
      encoding: "utf8"
    });
    expect(result.stdout.trim()).toBe("installed");
    expect(readFileSync(join(target, "Contents", "version"), "utf8")).toBe("new");
  });

  it("handles paths with spaces and quotes", () => {
    const { root, target, staged, script } = fixture();
    const odd = join(root, 'My "Apps" & more', "Chaturanga.app");
    mkdirSync(join(odd, ".."), { recursive: true });
    spawnSync("/bin/mv", [target, odd]);
    const result = spawnSync("/bin/sh", [script, deadPid(), odd, staged, "0"], {
      encoding: "utf8"
    });
    expect(result.stdout.trim()).toBe("installed");
    expect(readFileSync(join(odd, "Contents", "version"), "utf8")).toBe("new");
  });
});

describe("swapResult", () => {
  it("reads the result line the swap script ends with", () => {
    expect(swapResult("installed\n")).toEqual({ installed: true, detail: "installed" });
    expect(swapResult("noise\nfailed: could not move the current version aside\n")).toEqual({
      installed: false,
      detail: "could not move the current version aside"
    });
    expect(swapResult("")).toBeNull();
  });
});
