import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => tmpdir() } }));

import sf19 from "./__fixtures__/github/stockfish-latest-sf_19.json";
import { AssetManager, type ProgressEvent } from "./asset-manager";
import { ENGINE_MANIFEST, type EngineManifest } from "./engine-manifest";

/** engine-assets.json as the manager writes it. */
type SavedAssets = { records: { id: string; state: string; customPath?: string | null }[] };

const SF_API = "https://api.github.com/repos/official-stockfish/Stockfish/releases/latest";
const LC0_API = "https://api.github.com/repos/LeelaChessZero/lc0/releases/latest";
const MODEL_URL = "https://raw.githubusercontent.com/test/model.onnx";
const SF_ASSET = "stockfish-macos-universal.tar.gz";
const SF_URL = `https://github.com/official-stockfish/Stockfish/releases/download/sf_19/${SF_ASSET}`;
const SF_CDN =
  "https://release-assets.githubusercontent.com/github-production-release-asset/20976138/abc?sig=x";

const NETWORK_URL = "https://storage.lczero.org/files/test/t1-test.pb.gz";
const modelBytes = Buffer.from("fake maia 3 model");
const networkBytes = Buffer.from("fake lc0 network");
const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");

function manifestWithMaia3(file: EngineManifest["maia3"]["file"]): EngineManifest {
  return { ...ENGINE_MANIFEST, maia3: { version: "maia3-test", file } };
}

function manifestWithNetwork(url: string): EngineManifest {
  return {
    ...ENGINE_MANIFEST,
    lc0Network: { version: "T1-test", file: { url, sizeBytes: networkBytes.length } }
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
function releaseServing(
  archive: Buffer,
  digest: string | null = `sha256:${sha256(archive)}`,
  url = SF_URL
) {
  return {
    ...sf19,
    assets: sf19.assets.map((a) =>
      a.name === SF_ASSET ? { ...a, size: archive.length, digest, browser_download_url: url } : a
    )
  };
}

/** The manager's download progress events, collected as they come. */
function downloadEvents(manager: AssetManager) {
  const events: Extract<ProgressEvent, { type: "download" }>[] = [];
  manager.on("progress", (event) => {
    if (event.type === "download") events.push(event);
  });
  return events;
}

/** The messages of the manager's error progress events, collected as they come. */
function errorMessages(manager: AssetManager) {
  const messages: string[] = [];
  manager.on("progress", (event) => {
    if (event.type === "error") messages.push(event.message);
  });
  return messages;
}

/** A stored asset record of `file` (a custom one names it as its custom path too). */
const storedRecord = (id: string, state: string, file: string) => ({
  id,
  state,
  installedPath: file,
  customPath: state === "custom" ? file : null,
  sha256: null,
  manifestVersion: "v1.0",
  sizeBytes: 7,
  installedAt: null
});

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, ...init });

describe("AssetManager", () => {
  let userDataDir: string;
  let workDir: string;
  let routes: Partial<Record<string, () => Response | Promise<Response>>>;
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
    routes = { [MODEL_URL]: () => new Response(modelBytes) };
    fetchMock = vi.fn(
      async (url: string) => routes[url]?.() ?? new Response("not found", { status: 404 })
    );
  });

  afterEach(() => {
    rmSync(userDataDir, { recursive: true, force: true });
    rmSync(workDir, { recursive: true, force: true });
  });

  it("makes no network request on init or when reading status", async () => {
    const manager = makeManager();
    await manager.init();
    expect(Object.values(manager.getInstalled()).map((record) => record.state)).toStrictEqual(
      Array(4).fill("missing")
    );
    const status = await manager.getStatus();
    expect(fetchMock).not.toHaveBeenCalled();
    // Nothing cached yet: the fallback manifest answers, with real sizes.
    expect(status.stockfish).toMatchObject({
      latestVersion: "sf_19",
      latestSource: "fallback",
      downloadSizeBytes: 82_323_876,
      updateAvailable: false
    });
    expect(status.maia3).toMatchObject({
      latestSource: "fixed",
      latestVersion: "maia3_simplified@0013cc8",
      downloadSizeBytes: 45_683_686,
      autoDownload: true
    });
    // Maia 1 is retired: no longer an asset.
    expect(Object.keys(status)).not.toContain("maia-1100");
    expect(status.lc0).toMatchObject({
      autoDownload: false,
      latestVersion: null,
      installInstructions: "brew install lc0"
    });
    // Lc0's network downloads even where Lc0 itself has to be installed by hand.
    expect(status["lc0-network"]).toMatchObject({
      latestSource: "fixed",
      latestVersion: "T1-256x10-distilled-swa-2432500",
      downloadSizeBytes: 37_118_673,
      autoDownload: true
    });
  });

  it("downloads Lc0's network from LCZero's storage, takes the user's own, and goes back to it", async () => {
    routes[NETWORK_URL] = () => new Response(networkBytes);
    const manager = makeManager(manifestWithNetwork(NETWORK_URL));
    await manager.init();

    await manager.downloadAsset("lc0-network");
    expect(calledUrls()).toStrictEqual([NETWORK_URL]);
    const downloaded = manager.getInstalled()["lc0-network"];
    expect(downloaded).toMatchObject({ state: "installed", version: "T1-test", source: "fixed" });
    expect(readFileSync(downloaded.installedPath!)).toStrictEqual(networkBytes);

    const own = path.join(workDir, "BT4-1024x15.pb");
    writeFileSync(own, "user's network");
    await manager.setCustomPath("lc0-network", own);
    expect(manager.getInstalled()["lc0-network"]).toMatchObject({
      state: "custom",
      customPath: own
    });
    // The download it replaces is deleted: forgetting a custom file never deletes anything.
    expect(existsSync(downloaded.installedPath!)).toBe(false);

    // "Use default network" is a download again; the user's file stays where it was.
    await manager.downloadAsset("lc0-network");
    expect(manager.getInstalled()["lc0-network"]).toMatchObject({
      state: "installed",
      customPath: null,
      installedPath: downloaded.installedPath
    });
    expect(existsSync(own)).toBe(true);
  });

  it("accepts only a .pb / .pb.gz file that isn't a Maia network as Lc0's network", async () => {
    const manager = makeManager();
    await manager.init();
    const file = (name: string) => {
      const full = path.join(workDir, name);
      writeFileSync(full, "data");
      return full;
    };
    await expect(manager.setCustomPath("lc0-network", file("notes.txt"))).rejects.toThrow(
      /\.pb or \.pb\.gz/
    );
    for (const maia of ["maia-1500.pb.gz", "maia.pb.gz", "Maia_weights.pb"]) {
      await expect(manager.setCustomPath("lc0-network", file(maia)), maia).rejects.toThrow(
        /Maia network/
      );
    }
    expect(manager.getInstalled()["lc0-network"].state).toBe("missing");
    await manager.setCustomPath("lc0-network", file("t3-512x15.PB.GZ"));
    expect(manager.getInstalled()["lc0-network"].state).toBe("custom");
  });

  it("refuses Lc0's network from any host but LCZero's storage", async () => {
    const manager = makeManager(manifestWithNetwork(MODEL_URL));
    await manager.init();
    await expect(manager.downloadAsset("lc0-network")).rejects.toThrow(/Refusing to download/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("downloads, verifies and records the Maia 3 model, fetching only the model", async () => {
    const manager = makeManager(
      manifestWithMaia3({
        url: MODEL_URL,
        sizeBytes: modelBytes.length,
        sha256: sha256(modelBytes)
      })
    );
    await manager.init();
    const events: ProgressEvent["type"][] = [];
    manager.on("progress", (event) => events.push(event.type));

    await manager.downloadAsset("maia3");

    expect(calledUrls()).toStrictEqual([MODEL_URL]);
    const record = manager.getInstalled().maia3;
    expect(record).toMatchObject({
      state: "installed",
      installedPath: path.join(userDataDir, "engines", "maia3_simplified.onnx"),
      sha256: sha256(modelBytes),
      manifestVersion: "maia3-test",
      version: "maia3-test",
      source: "fixed"
    });
    expect(readFileSync(record.installedPath!)).toStrictEqual(modelBytes);
    // A model, not a program: never executable.
    expect(statSync(record.installedPath!).mode & 0o111).toBe(0);
    expect(events).toContain("verify");
    expect(events.at(-1)).toBe("ready");
  });

  it("refuses the Maia 3 model from any host but raw GitHub", async () => {
    routes[NETWORK_URL] = () => new Response(modelBytes);
    const manager = makeManager(
      manifestWithMaia3({ url: NETWORK_URL, sizeBytes: modelBytes.length })
    );
    await manager.init();
    await expect(manager.downloadAsset("maia3")).rejects.toThrow(/Refusing to download/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never points Maia 3 at the user's own file", async () => {
    const own = path.join(workDir, "maia3_simplified.onnx");
    writeFileSync(own, "user's model");
    const manager = makeManager();
    await manager.init();
    await expect(manager.setCustomPath("maia3", own)).rejects.toThrow(/managed by the app/);
    expect(manager.getInstalled().maia3.state).toBe("missing");
  });

  it("installs the latest Stockfish from GitHub, verifying the release digest", async () => {
    const archive = buildStockfishArchive(workDir, "#!/bin/sh\necho stockfish 19\n");
    routes[SF_API] = () => json(releaseServing(archive));
    routes[SF_URL] = () => new Response(null, { status: 302, headers: { location: SF_CDN } });
    routes[SF_CDN] = () =>
      new Response(new Uint8Array(archive), {
        headers: { "content-length": String(archive.length) }
      });
    const manager = makeManager();
    await manager.init();
    const downloads = downloadEvents(manager);

    await manager.downloadAsset("stockfish");

    const record = manager.getInstalled().stockfish;
    expect(record).toMatchObject({
      state: "installed",
      version: "sf_19",
      manifestVersion: "sf_19",
      source: "github"
    });
    expect(record.installedPath).toBe(path.join(userDataDir, "engines", "stockfish"));
    expect(readFileSync(record.installedPath!, "utf-8")).toContain("echo stockfish 19");
    expect(statSync(record.installedPath!).mode & 0o111).not.toBe(0);
    expect(downloads.at(-1)).toMatchObject({
      bytesReceived: archive.length,
      bytesTotal: archive.length
    });
    // No staging dirs, archives or partials left behind.
    expect(
      readdirSync(path.join(userDataDir, "engines")).filter((n) => n !== ".downloads")
    ).toStrictEqual(["stockfish"]);
    expect(readdirSync(path.join(userDataDir, "engines", ".downloads"))).toStrictEqual([]);
    expect(calledUrls()).toStrictEqual([SF_API, SF_URL, SF_CDN]);
  });

  it("rejects an archive whose digest does not match the release, after one retry", async () => {
    const archive = buildStockfishArchive(workDir, "tampered");
    routes[SF_API] = () => json(releaseServing(archive, `sha256:${"0".repeat(64)}`));
    routes[SF_URL] = () => new Response(new Uint8Array(archive));
    const manager = makeManager();
    await manager.init();
    const errors = errorMessages(manager);

    await expect(manager.downloadAsset("stockfish")).rejects.toThrow(
      "sha256 mismatch for stockfish"
    );

    expect(calledUrls().filter((url) => url === SF_URL)).toHaveLength(2);
    expect(errors).toStrictEqual(["sha256 mismatch for stockfish"]);
    expect(manager.getInstalled().stockfish.state).toBe("missing");
    expect(existsSync(path.join(userDataDir, "engines", "stockfish"))).toBe(false);
    expect(readdirSync(path.join(userDataDir, "engines", ".downloads"))).toStrictEqual([]);
  });

  it("rejects a Maia 3 model whose digest does not match the pinned one", async () => {
    const manager = makeManager(
      manifestWithMaia3({ url: MODEL_URL, sizeBytes: modelBytes.length, sha256: "0".repeat(64) })
    );
    await manager.init();
    await expect(manager.downloadAsset("maia3")).rejects.toThrow("sha256 mismatch for maia3");
    expect(calledUrls().filter((url) => url === MODEL_URL)).toHaveLength(2);
    expect(manager.getInstalled().maia3.state).toBe("missing");
    expect(existsSync(path.join(userDataDir, "engines", "maia3_simplified.onnx"))).toBe(false);
  });

  it("falls back to the bundled manifest when GitHub rate-limits the lookup", async () => {
    routes[SF_API] = () =>
      json(
        { message: "API rate limit exceeded" },
        {
          status: 403,
          headers: { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "4102444800" }
        }
      );
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
    routes[SF_API] = () =>
      json(releaseServing(archive, null, "https://evil.example/stockfish.tar.gz"));
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
    writeFileSync(
      path.join(userDataDir, "engine-assets.json"),
      JSON.stringify({ records: [legacy] })
    );
    const archive = buildStockfishArchive(workDir, "new stockfish 19");
    routes[SF_API] = () => json(releaseServing(archive));
    routes[SF_URL] = () => new Response(new Uint8Array(archive));
    const manager = makeManager();
    await manager.init();

    // Without a lookup there is no GitHub answer, so no update claim from the fallback.
    expect((await manager.getStatus()).stockfish).toMatchObject({
      installedVersion: "17.1",
      updateAvailable: false
    });
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
    expect(after.stockfish).toMatchObject({
      installedPath,
      installedVersion: "sf_19",
      updateAvailable: false
    });
    // The API was called once: the download reused the fresh lookup.
    expect(calledUrls().filter((url) => url === SF_API)).toHaveLength(1);
  });

  it("does not flag an update when the installed bare version equals the latest tag", async () => {
    const installedPath = path.join(workDir, "stockfish");
    writeFileSync(installedPath, "stockfish 19");
    const legacy = {
      id: "stockfish",
      state: "installed",
      installedPath,
      customPath: null,
      sha256: null,
      manifestVersion: "19",
      sizeBytes: 1,
      installedAt: null
    };
    writeFileSync(
      path.join(userDataDir, "engine-assets.json"),
      JSON.stringify({ records: [legacy] })
    );
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
    expect(calledUrls()).toStrictEqual([SF_API]);

    const second = makeManager();
    await second.init();
    await second.refreshReleasesInBackground();
    expect((await second.getStatus()).stockfish).toMatchObject({
      latestSource: "github",
      latestVersion: "sf_19"
    });
    expect(calledUrls()).toStrictEqual([SF_API]);
    expect(calledUrls()).not.toContain(LC0_API);
  });

  it("forgets a custom path without deleting the user's file", async () => {
    const own = path.join(workDir, "lc0");
    writeFileSync(own, "user's lc0");
    const manager = makeManager();
    await manager.init();
    await manager.setCustomPath("lc0", own);
    expect((await manager.getStatus()).lc0).toMatchObject({
      state: "custom",
      updateAvailable: false
    });
    await manager.removeAsset("lc0");
    expect(existsSync(own)).toBe(true);
    expect(manager.getInstalled().lc0.state).toBe("missing");
  });

  it("never deletes a replaced file outside the engines folder", async () => {
    const elsewhere = path.join(workDir, "stockfish-old");
    const own = path.join(workDir, "stockfish-own");
    writeFileSync(elsewhere, "binary");
    writeFileSync(own, "user's stockfish");
    writeFileSync(
      path.join(userDataDir, "engine-assets.json"),
      JSON.stringify({ records: [storedRecord("stockfish", "installed", elsewhere)] })
    );
    const manager = makeManager();
    await manager.init();
    await manager.setCustomPath("stockfish", own);
    expect(existsSync(elsewhere)).toBe(true);
    expect(manager.getInstalled().stockfish).toMatchObject({ state: "custom", customPath: own });
  });

  it("restores records whose files were deleted or moved as missing", async () => {
    const kept = path.join(workDir, "maia3_simplified.onnx");
    writeFileSync(kept, "model");
    writeFileSync(
      path.join(userDataDir, "engine-assets.json"),
      JSON.stringify({
        records: [
          storedRecord("lc0-network", "installed", path.join(workDir, "deleted.pb.gz")),
          storedRecord("maia3", "installed", kept),
          storedRecord("lc0", "custom", path.join(workDir, "moved-lc0"))
        ]
      })
    );
    const manager = makeManager();
    await manager.init();
    const installed = manager.getInstalled();
    expect(installed["lc0-network"]).toMatchObject({ state: "missing", installedPath: null });
    expect(installed.maia3).toMatchObject({ state: "installed", installedPath: kept });
    expect(installed.lc0).toMatchObject({ state: "missing", customPath: null });
    // The corrected state is persisted.
    const saved = JSON.parse(
      readFileSync(path.join(userDataDir, "engine-assets.json"), "utf-8")
    ) as SavedAssets;
    expect(saved.records.find((r) => r.id === "lc0-network")?.state).toBe("missing");
  });

  it("removes Maia 1 on init: its weights, partials, licence copy and records, never a file outside the engines folder", async () => {
    const engines = path.join(userDataDir, "engines");
    const downloads = path.join(engines, ".downloads");
    mkdirSync(downloads, { recursive: true });
    const inEngines = (name: string) => {
      const full = path.join(engines, name);
      writeFileSync(full, "data");
      return full;
    };
    const installedWeight = inEngines("maia-1100.pb.gz");
    const orphanWeight = inEngines("maia-1500.pb.gz");
    const license = inEngines("LICENSE_MAIA.txt");
    const network = inEngines("lc0-network.pb.gz");
    const maiaPartial = path.join(downloads, "maia-1300--v1.0--maia-1300.pb.gz.partial");
    const networkPartial = path.join(downloads, "lc0-network--T1--t1.pb.gz.partial");
    writeFileSync(maiaPartial, "part");
    writeFileSync(networkPartial, "part");
    const ownWeight = path.join(workDir, "maia-1700.pb.gz");
    const outsideWeight = path.join(workDir, "maia-1900.pb.gz");
    writeFileSync(ownWeight, "user's weights");
    writeFileSync(outsideWeight, "weights");
    const statePath = path.join(userDataDir, "engine-assets.json");
    writeFileSync(
      statePath,
      JSON.stringify({
        records: [
          storedRecord("maia-1100", "installed", installedWeight),
          storedRecord("maia-1700", "custom", ownWeight),
          storedRecord("maia-1900", "installed", outsideWeight),
          storedRecord("lc0-network", "installed", network)
        ]
      })
    );

    const manager = makeManager();
    await manager.init();

    for (const gone of [installedWeight, orphanWeight, license, maiaPartial])
      expect(existsSync(gone), gone).toBe(false);
    for (const kept of [network, networkPartial, ownWeight, outsideWeight])
      expect(existsSync(kept), kept).toBe(true);
    const saved = JSON.parse(readFileSync(statePath, "utf-8")) as SavedAssets;
    expect(saved.records.map((r) => r.id)).toStrictEqual(["lc0-network"]);
    expect(Object.keys(manager.getInstalled())).not.toContain("maia-1700");
    expect(manager.getInstalled()["lc0-network"].state).toBe("installed");

    // Idempotent: the next launch finds nothing to do and leaves the state as it is.
    const savedText = readFileSync(statePath, "utf-8");
    await makeManager().init();
    expect(readFileSync(statePath, "utf-8")).toBe(savedText);
  });

  it("serializes concurrent state writes without temp-file collisions", async () => {
    const own = path.join(workDir, "lc0");
    writeFileSync(own, "user's lc0");
    const manager = makeManager();
    await manager.init();
    // Several completions persisting at once must all succeed and leave one consistent file.
    await Promise.all([
      manager.setCustomPath("lc0", own),
      manager.removeAsset("stockfish"),
      manager.removeAsset("maia3")
    ]);
    const saved = JSON.parse(
      readFileSync(path.join(userDataDir, "engine-assets.json"), "utf-8")
    ) as SavedAssets;
    expect(saved.records.find((r) => r.id === "lc0")).toMatchObject({
      state: "custom",
      customPath: own
    });
    expect(readdirSync(userDataDir).filter((name) => name.endsWith(".tmp"))).toStrictEqual([]);
  });

  it("explains the manual Lc0 install on macOS", async () => {
    const manager = makeManager();
    await manager.init();
    await expect(manager.downloadAsset("lc0")).rejects.toThrow(/brew install lc0/);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
