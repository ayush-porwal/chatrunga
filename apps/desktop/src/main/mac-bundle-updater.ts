/**
 * In-place updates for macOS builds without an Apple Developer ID signature.
 *
 * electron-updater installs macOS updates through Squirrel.Mac, which only accepts an update signed
 * by the same Developer ID as the running app, so an ad-hoc-signed build can never update that way.
 * This does the same job directly:
 * 1. download the release ZIP for this CPU (listed with its SHA-512 in latest-mac.yml) and verify it;
 * 2. unpack it with ditto into the profile's `pending-update` folder and check the bundle: same
 *    bundle identifier, the expected version, an intact code signature;
 * 3. on "Restart to update" (or a normal quit), a small detached script waits for the app to exit,
 *    swaps the new bundle in for the running one and, when asked, reopens it.
 *
 * The download never passes through a browser, so the new bundle carries no quarantine flag and
 * opens without the Gatekeeper "could not verify" dialog.
 */
import { net } from "electron";
import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream, writeFileSync } from "node:fs";
import { access, constants, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { errorMessage, logger } from "./logger";
import { BUNDLE_SWAP_SCRIPT, isSwappableBundlePath, swapResult } from "./updater-state";
import { readableFromBody } from "./web-stream";

/** The .app that contains the running executable (`…/Chaturanga.app/Contents/MacOS/Chaturanga`). */
export function runningBundlePath(execPath: string): string {
  return dirname(dirname(dirname(execPath)));
}

/**
 * Whether this bundle can be replaced in place: not a DMG or translocated copy, in a folder we can
 * write (the swap renames the bundle's entry there; nothing inside the bundle is written).
 */
export async function canReplaceBundle(bundlePath: string): Promise<boolean> {
  if (!isSwappableBundlePath(bundlePath)) return false;
  try {
    await access(dirname(bundlePath), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

export type BundleDownload = { url: string; sha512: string; size: number | null; version: string };

export class MacBundleUpdater {
  private staged: { version: string; bundle: string } | null = null;
  private swapStarted = false;

  constructor(
    private readonly bundlePath: string,
    private readonly stagingRoot: string
  ) {}

  /** Version whose bundle is unpacked and verified, waiting for a restart; null when none. */
  get readyVersion(): string | null {
    return this.staged?.version ?? null;
  }

  /**
   * Clears a previous session's leftovers (a download interrupted by quitting). If that session's
   * swap script is still waiting to move the staged bundle (the app was reopened right after
   * quitting), it waits for the script first, so the update isn't deleted from under it.
   */
  async clearStaging(): Promise<void> {
    await this.waitForPendingSwap();
    await rm(this.stagingRoot, { recursive: true, force: true });
  }

  /**
   * The outcome of the last session's swap (the script's log), read before staging is cleared so a
   * failed install is reported rather than silently lost. Null when no swap ran.
   */
  async lastSwapResult(): Promise<{ installed: boolean; detail: string } | null> {
    await this.waitForPendingSwap();
    return this.readSwapResult();
  }

  private async readSwapResult(): Promise<{ installed: boolean; detail: string } | null> {
    return swapResult(await readFile(join(this.stagingRoot, "swap.log"), "utf8").catch(() => ""));
  }

  private async waitForPendingSwap(): Promise<void> {
    // A logged result means the script is done (and a pid from before a reboot may belong to anything).
    if (await this.readSwapResult()) return;
    const pid = Number((await readFile(join(this.stagingRoot, "swap.pid"), "utf8").catch(() => "")).trim());
    if (!Number.isInteger(pid) || pid <= 0) return;
    // Only while that pid is still our swap script: a pid reused by another process (after a reboot
    // cut the script short) is not waited for. The script itself gives up after 60s.
    const script = join(this.stagingRoot, "swap.sh");
    for (let waited = 0; waited < 70_000 && (await isSwapScript(pid, script)); waited += 200) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  /** Downloads, verifies and unpacks `update`. Rejects with a readable-enough error on any failure. */
  async download(update: BundleDownload, onProgress: (transferred: number, total: number) => void): Promise<void> {
    this.staged = null;
    await this.clearStaging();
    const dir = join(this.stagingRoot, update.version);
    await mkdir(dir, { recursive: true });
    const zipPath = join(dir, "update.zip");

    const response = await net.fetch(update.url);
    if (!response.ok || !response.body) throw new Error(`download failed: HTTP ${response.status}`);
    const total = Number(response.headers.get("content-length")) || update.size || 0;
    const hash = createHash("sha512");
    let transferred = 0;
    let lastReport = 0;
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        hash.update(chunk);
        transferred += chunk.length;
        const now = Date.now();
        if (now - lastReport > 150) {
          lastReport = now;
          onProgress(transferred, total);
        }
        done(null, chunk);
      }
    });
    await pipeline(readableFromBody(response.body), meter, createWriteStream(zipPath));
    onProgress(transferred, total || transferred);
    if (hash.digest("base64") !== update.sha512) throw new Error("sha512 checksum mismatch");

    const unpacked = join(dir, "unpacked");
    await run("/usr/bin/ditto", ["-x", "-k", zipPath, unpacked]);
    await rm(zipPath, { force: true });
    const bundles = (await readdir(unpacked)).filter((name) => name.endsWith(".app"));
    if (bundles.length !== 1) throw new Error(`expected one app in the update, found ${bundles.length}`);
    const bundle = join(unpacked, bundles[0]);

    const [identifier, runningIdentifier, version] = await Promise.all([
      plistValue(bundle, "CFBundleIdentifier"),
      plistValue(this.bundlePath, "CFBundleIdentifier"),
      plistValue(bundle, "CFBundleShortVersionString")
    ]);
    if (identifier !== runningIdentifier) throw new Error(`update is a different app (${identifier})`);
    if (version !== update.version) throw new Error(`update is version ${version}, expected ${update.version}`);
    await run("/usr/bin/codesign", ["--verify", "--deep", "--strict", bundle]).catch((error) => {
      throw new Error(`code signature invalid: ${errorMessage(error)}`);
    });
    // Belt and braces: nothing here sets it, but a quarantined bundle would hit Gatekeeper on launch.
    await run("/usr/bin/xattr", ["-dr", "com.apple.quarantine", bundle]).catch(() => undefined);

    this.staged = { version: update.version, bundle };
    logger.info("updater", `update ${update.version} unpacked and verified`);
  }

  /**
   * Hands the swap to a detached script that runs once this process exits. The caller quits the
   * app right after. Synchronous, so it also works from `will-quit`. Returns false when nothing is
   * staged or a swap was already started.
   */
  startSwap(options: { relaunch: boolean }): boolean {
    if (!this.staged || this.swapStarted) return false;
    this.swapStarted = true;
    const script = join(this.stagingRoot, "swap.sh");
    writeFileSync(script, BUNDLE_SWAP_SCRIPT, { mode: 0o755 });
    const log = join(this.stagingRoot, "swap.log");
    const child = spawn(
      "/bin/sh",
      ["-c", 'exec /bin/sh "$0" "$@" >>"$LOG" 2>&1', script, String(process.pid), this.bundlePath, this.staged.bundle, options.relaunch ? "1" : "0"],
      { detached: true, stdio: "ignore", env: { PATH: "/usr/bin:/bin:/usr/sbin:/sbin", LOG: log } }
    );
    child.unref();
    if (child.pid) writeFileSync(join(this.stagingRoot, "swap.pid"), String(child.pid));
    logger.info("updater", `swapping in ${this.staged.version} after quit (relaunch: ${options.relaunch})`);
    return true;
  }
}

/** Whether `pid` is running `script` (its command line, from `ps`); false once it has exited. */
async function isSwapScript(pid: number, script: string): Promise<boolean> {
  const command = await run("/bin/ps", ["-p", String(pid), "-o", "command="]).catch(() => "");
  return command.includes(script);
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 120_000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${file.split("/").pop()} failed: ${(stderr || error.message).trim()}`));
      else resolve(stdout);
    });
  });
}

async function plistValue(bundle: string, key: string): Promise<string> {
  return (await run("/usr/bin/plutil", ["-extract", key, "raw", "-o", "-", join(bundle, "Contents", "Info.plist")])).trim();
}
