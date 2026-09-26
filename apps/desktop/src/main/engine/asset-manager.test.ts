import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

import sf19 from "./__fixtures__/github/stockfish-latest-sf_19.json";
import { AssetManager, type ProgressEvent } from "./asset-manager";
import { ENGINE_MANIFEST, type EngineManifest } from "./engine-manifest";

const SF_API = "https://api.github.com/repos/official-stockfish/Stockfish/releases/latest";
const LC0_API = "https://api.github.com/repos/LeelaChessZero/lc0/releases/latest";
const WEIGHT_URL = "https://raw.githubusercontent.com/test/maia-1100.pb.gz";
const LICENSE_URL = "https://raw.githubusercontent.com/test/LICENSE";
const SF_ASSET = "stockfish-macos-universal.tar.gz";
const SF_URL = `https://github.com/official-stockfish/Stockfish/releases/download/sf_19/${SF_ASSET}`;
const SF_CDN = "https://release-assets.githubusercontent.com/github-production-release-asset/20976138/abc?sig=x";

const weightBytes = Buffer.from("fake maia weights");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function manifestWithWeight(entry: EngineManifest["maiaWeights"]["files"]["maia-1100"]): EngineManifest {
  return {
    ...ENGINE_MANIFEST,
    maiaWeights: { ...ENGINE_MANIFEST.maiaWeights, files: { ...ENGINE_MANIFEST.maiaWeights.files, "maia-1100": entry } },
    licenses: { maia: { ...ENGINE_MANIFEST.licenses.maia, noticeUrl: LICENSE_URL } }
  };
}

/** A real Stockfish-shaped archive: stockfish/<binary> next to docs. */
function buildStockfishArchive(workDir: string, binaryContent: string): Buffer {
  const src = path.join(workDir, `src-${Math.random().toString(36).slice(2)}`);
  mkdirSync(path.join(src, "stockfish", "wiki"), { recursive: true });
  writeFileSync(path.join(src, "stockfish", "stockfish-macos-universal"), binaryContent);
  writeFileSync(path.join(src, "stockfish", "Copying.txt"), "GPL");
  writeFileSync(path.join(src, "stockfish", "wiki", "Home.md"), "# wiki");
  const out = path.join(workDir, `${path.basename(src)}.tar.gz`);
  execFileSync("tar", ["-czf", out, "-C", src, "stockfish"]);
  return readFileSync(out);
}

/** The recorded sf_19 release with the macOS asset swapped for `archive`. */
function releaseServing(archive: Buffer, digest: string | null = `sha256:${sha256(archive)}`, url = SF_URL) {
  return {
    ...sf19,
    assets: sf19.assets.map((a) => (a.name === SF_ASSET ? { ...a, size: archive.length, digest, browser_download_url: url } : a))
  };
}

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });

describe("AssetManager", () => {
  let userDataDir: string;
  let workDir: string;
  let routes: Record<string, () => Response | Promise<Response>>;
  let fetchMock: ReturnType<typeof vi.fn>;

  const makeManager = (manifest?: EngineManifest) =>
    new AssetManager({
      userDataDir,
      manifest,
      platformKey: "darwin-arm64",
      cpuFeatures: async () => null,
      fetchImpl: fetchMock as never
    });
  const calledUrls = () => fetchMock.mock.calls.map(([url]) => url as string);

  beforeEach(() => {
    userDataDir = mkdtempSync(path.join(tmpdir(), "chaturanga-assets-"));
    workDir = mkdtempSync(path.join(tmpdir(), "chaturanga-assets-work-"));
    routes = {
      [WEIGHT_URL]: () => new Response(weightBytes),
      [LICENSE_URL]: () => new Response("license text")
    };
    fetchMock = vi.fn(async (url: string) => routes[url]?.() ?? new Response("not found", { status: 404 }));
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("makes no network request on init or when reading status", async () => {
    const manager = makeManager();
    await manager.init();
    expect(Object.values(manager.getInstalled()).map((record) => record.state)).toEqual(Array(7).fill("missing"));
    const status = await manager.getStatus();
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing cached yet: the fallback manifest answers, with real sizes.
    expect(status.stockfish).toMatchObject({ latestVersion: "sf_19", latestSource: "fallback", downloadSizeBytes: 82_323_876, updateAvailable: false });
    expect(status["maia-1100"]).toMatchObject({ latestSource: "fixed", downloadSizeBytes: 1_313_193, autoDownload: true });
    expect(status.lc0).toMatchObject({ autoDownload: false, latestVersion: null, installInstructions: "brew install lc0" });
  });

  it("downloads, verifies and records a Maia weight, fetching only the asset and its license", async () => {
    const manager = makeManager(manifestWithWeight({ url: WEIGHT_URL, sizeBytes: weightBytes.length, sha256: sha256(weightBytes) }));
    await manager.init();
    const events: ProgressEvent["type"][] = [];
    manager.on("progress", (event) => events.push(event.type));

    await manager.downloadAsset("maia-1100");

    expect(calledUrls().sort()).toEqual([LICENSE_URL, WEIGHT_URL].sort());
    const record = manager.getInstalled()["maia-1100"];
    expect(record).toMatchObject({ state: "installed", sha256: sha256(weightBytes), manifestVersion: "v1.0", version: "v1.0", source: "fixed" });
    expect(readFileSync(record.installedPath!)).toEqual(weightBytes);
    expect(events).toContain("verify");
    expect(events.at(-1)).toBe("ready");
  });

  it("installs the latest Stockfish from GitHub, verifying the release digest", async () => {
    const archive = buildStockfishArchive(workDir, "#!/bin/sh\necho stockfish 19\n");
    routes[SF_API] = () => json(releaseServing(archive));
    routes[SF_URL] = () => new Response(null, { status: 302, headers: { location: SF_CDN } });
    routes[SF_CDN] = () => new Response(new Uint8Array(archive), { headers: { "content-length": String(archive.length) } });
    const manager = makeManager();
    await manager.init();
    const downloads: ProgressEvent[] = [];
    manager.on("progress", (event) => event.type === "download" && downloads.push(event));

    await manager.downloadAsset("stockfish");

    const record = manager.getInstalled().stockfish;
    expect(record).toMatchObject({ state: "installed", version: "sf_19", manifestVersion: "sf_19", source: "github" });
    expect(record.installedPath).toBe(path.join(userDataDir, "engines", "stockfish"));
    expect(readFileSync(record.installedPath!, "utf-8")).toContain("echo stockfish 19");
    expect(statSync(record.installedPath!).mode & 0o111).not.toBe(0);
    expect(downloads.at(-1)).toMatchObject({ bytesReceived: archive.length, bytesTotal: archive.length });
    // No staging dirs, archives or partials left behind.
    expect(readdirSync(path.join(userDataDir, "engines")).filter((n) => n !== ".downloads")).toEqual(["stockfish"]);
    expect(readdirSync(path.join(userDataDir, "engines", ".downloads"))).toEqual([]);
    expect(calledUrls()).toEqual([SF_API, SF_URL, SF_CDN]);
  });

  it("rejects an archive whose digest does not match the release, after one retry", async () => {
    const archive = buildStockfishArchive(workDir, "tampered");
    routes[SF_API] = () => json(releaseServing(archive, `sha256:${"0".repeat(64)}`));
    routes[SF_URL] = () => new Response(new Uint8Array(archive));
    const manager = makeManager();
    await manager.init();
    const errors: string[] = [];
    manager.on("progress", (event) => event.type === "error" && errors.push(event.message));

    await expect(manager.downloadAsset("stockfish")).rejects.toThrow("sha256 mismatch for stockfish");

    expect(calledUrls().filter((url) => url === SF_URL)).toHaveLength(2);
    expect(errors).toEqual(["sha256 mismatch for stockfish"]);
    expect(manager.getInstalled().stockfish.state).toBe("missing");
    expect(existsSync(path.join(userDataDir, "engines", "stockfish"))).toBe(false);
    expect(readdirSync(path.join(userDataDir, "engines", ".downloads"))).toEqual([]);
  });

  it("rejects a Maia weight whose digest does not match", async () => {
    const manager = makeManager(manifestWithWeight({ url: WEIGHT_URL, sizeBytes: weightBytes.length, sha256: "0".repeat(64) }));
    await manager.init();
    await expect(manager.downloadAsset("maia-1100")).rejects.toThrow("sha256 mismatch for maia-1100");
    expect(calledUrls().filter((url) => url === WEIGHT_URL)).toHaveLength(2);
    expect(manager.getInstalled()["maia-1100"].state).toBe("missing");
  });

  it("falls back to the bundled manifest when GitHub rate-limits the lookup", async () => {
    routes[SF_API] = () =>
      json({ message: "API rate limit exceeded" }, { status: 403, headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "4102444800" } });
    const manager = makeManager();
    await manager.init();

    const resolved = await manager.resolveDownload("stockfish");
    expect(resolved).toMatchObject({
      url: ENGINE_MANIFEST.stockfish.platforms["darwin-arm64"].url,
      sizeBytes: 82_323_876,
      sha256: null,
      version: "sf_19",
      source: "fallback"
    });
    expect(resolved?.checkError).toMatch(/rate limit/);
    // Rate-limited until the reset: a check for updates does not call the API again.
    const status = await manager.checkForUpdates();
    expect(status.stockfish).toMatchObject({ latestSource: "fallback", updateAvailable: false });
    expect(calledUrls().filter((url) => url === SF_API)).toHaveLength(1);
  });

  it("falls back when the release asset URL is not a GitHub download of the expected repo", async () => {
    const archive = Buffer.from("x");
    routes[SF_API] = () => json(releaseServing(archive, null, "https://evil.example/stockfish.tar.gz"));
    const manager = makeManager();
    await manager.init();
    expect(await manager.resolveDownload("stockfish")).toMatchObject({ source: "fallback" });
  });

  it("reports an update for an install from an older release, keeping old state files readable", async () => {
    // State written by the previous app version: bare version, no `version`/`source` fields.
    const installedPath = path.join(userDataDir, "engines", "stockfish");
    mkdirSync(path.dirname(installedPath), { recursive: true });
    writeFileSync(installedPath, "old stockfish 17.1");
    const legacy = {
      id: "stockfish",
      state: "installed",
      installedPath,
      customPath: null,
      sha256: null,
      manifestVersion: "17.1",
      sizeBytes: 18,
      installedAt: "2026-01-01T00:00:00.000Z"
    };
    writeFileSync(path.join(userDataDir, "engine-assets.json"), JSON.stringify({ records: [legacy] }));
    const archive = buildStockfishArchive(workDir, "new stockfish 19");
    routes[SF_API] = () => json(releaseServing(archive));
    routes[SF_URL] = () => new Response(new Uint8Array(archive));
    const manager = makeManager();
    await manager.init();

    // Without a lookup there is no GitHub answer, so no update claim from the fallback.
    expect((await manager.getStatus()).stockfish).toMatchObject({ installedVersion: "17.1", updateAvailable: false });
    const checked = await manager.checkForUpdates();
    expect(checked.stockfish).toMatchObject({
      installedVersion: "17.1",
      latestVersion: "sf_19",
      latestSource: "github",
      updateAvailable: true,
      downloadSizeBytes: archive.length
    });
    expect(checked.stockfish.checkedAt).toBeTruthy();

    // The user-triggered update replaces the binary in place.
    await manager.downloadAsset("stockfish");
    expect(readFileSync(installedPath, "utf-8")).toBe("new stockfish 19");
    const after = await manager.getStatus();
    expect(after.stockfish).toMatchObject({ installedPath, installedVersion: "sf_19", updateAvailable: false });
    // The API was called once: the download reused the fresh lookup.
    expect(calledUrls().filter((url) => url === SF_API)).toHaveLength(1);
  });

  it("does not flag an update when the installed bare version equals the latest tag", async () => {
    const installedPath = path.join(workDir, "stockfish");
    writeFileSync(installedPath, "stockfish 19");
    const legacy = { id: "stockfish", state: "installed", installedPath, customPath: null, sha256: null, manifestVersion: "19", sizeBytes: 1, installedAt: null };
    writeFileSync(path.join(userDataDir, "engine-assets.json"), JSON.stringify({ records: [legacy] }));
    routes[SF_API] = () => json(sf19);
    const manager = makeManager();
    await manager.init();
    expect((await manager.checkForUpdates()).stockfish.updateAvailable).toBe(false);
  });

  it("caches the background lookup on disk so the next launch makes no API call", async () => {
    routes[SF_API] = () => json(sf19);
    const first = makeManager();
    await first.init();
    const changed = vi.fn();
    first.on("statusChanged", changed);
    await first.refreshReleasesInBackground();
    expect(changed).toHaveBeenCalledTimes(1);
    // Lc0 has no build for macOS: its repo is never queried there.
    expect(calledUrls()).toEqual([SF_API]);

    const second = makeManager();
    await second.init();
    await second.refreshReleasesInBackground();
    expect((await second.getStatus()).stockfish).toMatchObject({ latestSource: "github", latestVersion: "sf_19" });
    expect(calledUrls()).toEqual([SF_API]);
    expect(calledUrls()).not.toContain(LC0_API);
  });

  it("forgets a custom path without deleting the user's file", async () => {
    const own = path.join(workDir, "lc0");
    writeFileSync(own, "user's lc0");
    const manager = makeManager();
    await manager.init();
    await manager.setCustomPath("lc0", own);
    expect((await manager.getStatus()).lc0).toMatchObject({ state: "custom", updateAvailable: false });
    await manager.removeAsset("lc0");
    expect(existsSync(own)).toBe(true);
    expect(manager.getInstalled().lc0.state).toBe("missing");
  });

  it("restores records whose files were deleted or moved as missing", async () => {
    const kept = path.join(workDir, "maia-1300.pb.gz");
    writeFileSync(kept, "weights");
    const record = (id: string, state: string, file: string) => ({
      id,
      state,
      installedPath: file,
      customPath: state === "custom" ? file : null,
      sha256: null,
      manifestVersion: "v1.0",
      sizeBytes: 7,
      installedAt: null
    });
    writeFileSync(
      path.join(userDataDir, "engine-assets.json"),
      JSON.stringify({
        records: [
          record("maia-1100", "installed", path.join(workDir, "deleted.pb.gz")),
          record("maia-1300", "installed", kept),
          record("lc0", "custom", path.join(workDir, "moved-lc0"))
        ]
      })
    );
    const manager = makeManager();
    await manager.init();
    const installed = manager.getInstalled();
    expect(installed["maia-1100"]).toMatchObject({ state: "missing", installedPath: null });
    expect(installed["maia-1300"]).toMatchObject({ state: "installed", installedPath: kept });
    expect(installed.lc0).toMatchObject({ state: "missing", customPath: null });
    // The corrected state is persisted.
    const saved = JSON.parse(readFileSync(path.join(userDataDir, "engine-assets.json"), "utf-8"));
    expect(saved.records.find((r: { id: string }) => r.id === "maia-1100").state).toBe("missing");
  });

  it("serializes concurrent state writes without temp-file collisions", async () => {
    const own = path.join(workDir, "lc0");
    writeFileSync(own, "user's lc0");
    const manager = makeManager();
    await manager.init();
    // Several completions persisting at once must all succeed and leave one consistent file.
    await Promise.all([manager.setCustomPath("lc0", own), manager.removeAsset("maia-1100"), manager.removeAsset("maia-1300")]);
    const saved = JSON.parse(readFileSync(path.join(userDataDir, "engine-assets.json"), "utf-8"));
    expect(saved.records.find((r: { id: string }) => r.id === "lc0")).toMatchObject({ state: "custom", customPath: own });
    expect(readdirSync(userDataDir).filter((name) => name.endsWith(".tmp"))).toEqual([]);
  });

  it("explains the manual Lc0 install on macOS", async () => {
    const manager = makeManager();
    await manager.init();
    await expect(manager.downloadAsset("lc0")).rejects.toThrow(/brew install lc0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
