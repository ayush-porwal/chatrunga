// Launches the built Chaturanga app for the smoke journeys: a throwaway profile per test, no
// network, no native dialogs, nothing sent anywhere. Never points at a real profile.
import {
  _electron,
  expect,
  test as base,
  type ElectronApplication,
  type Page
} from "@playwright/test";
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, realpathSync, rmSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ChaturangaApi } from "../../../packages/shared/src/ipc/chaturanga-api";

export const desktopDir = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Every request the app makes goes here and is refused (port 9: discard, nothing listens). */
const BLACKHOLE = "http://127.0.0.1:9";

/**
 * The app under test: the electron-vite build (`out/main/index.js`) on the Electron from
 * node_modules by default. `CHATURANGA_E2E_EXECUTABLE=<path>` runs a packaged app's executable
 * instead; `CHATURANGA_E2E_PACKAGED=1` finds the one electron-builder left in `dist/`.
 */
export function appTarget(): { executablePath: string; args: string[]; packaged: boolean } {
  const explicit = process.env.CHATURANGA_E2E_EXECUTABLE;
  if (explicit) return { executablePath: resolve(explicit), args: [], packaged: true };
  if (process.env.CHATURANGA_E2E_PACKAGED === "1")
    return { executablePath: findPackagedExecutable(), args: [], packaged: true };
  const main = join(desktopDir, "out/main/index.js");
  if (!existsSync(main))
    throw new Error(`${main} is missing: run \`pnpm build\` in apps/desktop first.`);
  const electron = createRequire(join(desktopDir, "package.json"))("electron") as unknown as string;
  return { executablePath: electron, args: [main], packaged: false };
}

/** The unpacked app electron-builder wrote for this OS and CPU (`--dir`, or any target's staging folder). */
export function findPackagedExecutable(distDir = join(desktopDir, "dist")): string {
  const folders = existsSync(distDir)
    ? readdirSync(distDir).filter((name) => statSync(join(distDir, name)).isDirectory())
    : [];
  // electron-builder names x64 folders without a suffix (`mac`, `linux-unpacked`, `win-unpacked`).
  const archMatches = (name: string) =>
    process.arch === "x64"
      ? !/-(arm64|ia32|armv7l|universal)/.test(name)
      : name.includes(process.arch);
  const candidates: string[] = [];
  for (const folder of folders.filter(archMatches)) {
    const path = join(distDir, folder);
    if (process.platform === "darwin" && folder.startsWith("mac")) {
      candidates.push(join(path, "Chaturanga.app/Contents/MacOS/Chaturanga"));
    } else if (process.platform === "win32" && folder.startsWith("win")) {
      candidates.push(join(path, "Chaturanga.exe"));
    } else if (process.platform === "linux" && folder.startsWith("linux")) {
      // The executable is named after the package; the only other executables are Chromium helpers.
      for (const file of readdirSync(path)) {
        const full = join(path, file);
        const stat = statSync(full);
        if (stat.isFile() && stat.mode & 0o111 && !/^chrome|\.so(\.|$)/.test(file))
          candidates.push(full);
      }
    }
  }
  const found = candidates.find((path) => existsSync(path));
  if (!found)
    throw new Error(`No packaged app for ${process.platform}-${process.arch} under ${distDir}.`);
  return found;
}

export type LaunchedApp = { app: ElectronApplication; page: Page; pageErrors: string[] };

/**
 * Starts the app on `profile` and makes it safe to drive: network refused (Chromium through a dead
 * proxy, Node's fetch through the same proxy and a guard that only serves `routeToFile` URLs),
 * analytics and updates off, native open/save/message dialogs and external links stubbed.
 */
export async function launchApp(profile: string): Promise<LaunchedApp> {
  const target = appTarget();
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) env[key] = value;
  // A dev-server URL or run-as-node from the caller's shell would change what launches.
  delete env.ELECTRON_RENDERER_URL;
  delete env.ELECTRON_RUN_AS_NODE;
  Object.assign(env, {
    CHATURANGA_USER_DATA_DIR: profile,
    CHATURANGA_TELEMETRY_ENABLED: "false",
    // Packaged builds check for updates; they would ask this dead address instead of GitHub.
    CHATURANGA_UPDATE_FEED_URL: `${BLACKHOLE}/`,
    NODE_USE_ENV_PROXY: "1",
    HTTP_PROXY: BLACKHOLE,
    HTTPS_PROXY: BLACKHOLE,
    NO_PROXY: "localhost,127.0.0.1,::1"
  });
  const switches = [`--proxy-server=${BLACKHOLE}`];
  // macOS: Chromium keeps its cookie key in the login keychain under "Chaturanga Safe Storage". An
  // item an installed Chaturanga created belongs to that build's signature, so a freshly packaged
  // (ad-hoc signed) app reading it, as it does on quit, waits on a keychain password prompt and
  // never exits. A throwaway profile needs no real key: the mock keychain never asks.
  if (process.platform === "darwin") switches.push("--use-mock-keychain");
  // Escape hatch for Linux hosts without unprivileged user namespaces (no Chromium sandbox there).
  if (process.env.CHATURANGA_E2E_NO_SANDBOX === "1") switches.push("--no-sandbox");
  const app = await _electron.launch({
    executablePath: target.executablePath,
    args: [...switches, ...target.args],
    cwd: desktopDir,
    env,
    timeout: 60_000
  });
  await installMainProcessGuards(app);
  const page = await app.firstWindow();
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.waitForLoadState("domcontentloaded");
  return { app, page, pageErrors };
}

/** Test doubles inside the main process; their records live on `globalThis.__e2e`. */
async function installMainProcessGuards(app: ElectronApplication): Promise<void> {
  await app.evaluate(({ dialog, shell }) => {
    type Record = {
      fetches: string[];
      workers: string[];
      workerMessages: string[];
      workerAnswers: WorkerAnswer[];
      dialogs: string[];
      routes: { [url: string]: string };
    };
    const state: Record = {
      fetches: [],
      workers: [],
      workerMessages: [],
      workerAnswers: [],
      dialogs: [],
      routes: {}
    };
    (globalThis as unknown as { __e2e: Record }).__e2e = state;

    // Native dialogs would block the run: open/save are cancelled unless a test stubs a file;
    // message boxes answer their default button and are recorded.
    dialog.showOpenDialog = (async () => {
      state.dialogs.push("open");
      return { canceled: true, filePaths: [] };
    }) as typeof dialog.showOpenDialog;
    dialog.showSaveDialog = (async () => {
      state.dialogs.push("save");
      return { canceled: true, filePath: "" };
    }) as typeof dialog.showSaveDialog;
    dialog.showMessageBoxSync = ((...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as {
        message?: string;
        defaultId?: number;
      };
      state.dialogs.push(`message: ${options.message ?? ""}`);
      return options.defaultId ?? 0;
    }) as typeof dialog.showMessageBoxSync;
    dialog.showMessageBox = (async (...args: unknown[]) => {
      const options = (args.length > 1 ? args[1] : args[0]) as {
        message?: string;
        defaultId?: number;
      };
      state.dialogs.push(`message: ${options.message ?? ""}`);
      return { response: options.defaultId ?? 0, checkboxChecked: false };
    }) as typeof dialog.showMessageBox;
    shell.openExternal = async (url: string) => {
      state.dialogs.push(`openExternal: ${url}`);
    };

    // Node's fetch (Lichess, GitHub, dataset downloads): only routed URLs answer, from a local file.
    const fs = process.getBuiltinModule("node:fs");
    globalThis.fetch = async (input: string | URL | Request) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      state.fetches.push(url);
      const file = state.routes[url];
      if (!file) throw new TypeError(`fetch failed: network is disabled in the e2e run (${url})`);
      const body = fs.readFileSync(file);
      return new Response(body, {
        status: 200,
        headers: { "content-length": String(body.length), etag: '"e2e-fixture"' }
      });
    };

    // Records worker threads (the puzzle scan) and their answers. The bundle imports Worker as an
    // ES binding: syncBuiltinESMExports makes it see the wrapped class.
    const threads = process.getBuiltinModule("node:worker_threads");
    const Original = threads.Worker;
    threads.Worker = class RecordedWorker extends Original {
      constructor(filename: string | URL, options?: ConstructorParameters<typeof Original>[1]) {
        super(filename, options);
        state.workers.push(String(filename));
        this.once("message", (message: unknown) => {
          state.workerMessages.push(JSON.stringify(message).slice(0, 200));
          // A puzzle scan's answer, in full: whether it read the whole file, and the ids it kept.
          // Other workers (a repertoire import's writer) answer without rows.
          const answer = message as {
            ok?: boolean;
            result?: { rows?: string[][]; matches?: number; complete?: boolean };
          };
          state.workerAnswers.push({
            ok: answer.ok === true,
            complete: answer.result?.complete ?? null,
            matches: answer.result?.matches ?? null,
            ids: answer.result?.rows?.map((row) => row[0] ?? "") ?? []
          });
        });
      }
    };
    process.getBuiltinModule("node:module").syncBuiltinESMExports();
  });
}

/** A worker thread's answer, as recorded: a puzzle scan's is `{ ok, complete, matches, ids }`. */
export type WorkerAnswer = {
  ok: boolean;
  complete: boolean | null;
  matches: number | null;
  ids: string[];
};

/** What the main-process doubles recorded. */
export function mainRecord(app: ElectronApplication) {
  return app.evaluate(() => {
    const state = (
      globalThis as unknown as {
        __e2e: {
          fetches: string[];
          workers: string[];
          workerMessages: string[];
          workerAnswers: WorkerAnswer[];
          dialogs: string[];
        };
      }
    ).__e2e;
    return {
      fetches: [...state.fetches],
      workers: [...state.workers],
      workerMessages: [...state.workerMessages],
      workerAnswers: [...state.workerAnswers],
      dialogs: [...state.dialogs]
    };
  });
}

/** Serves `url` from a local file to the app's Node fetch (e.g. a dataset download). */
export function routeToFile(app: ElectronApplication, url: string, file: string) {
  return app.evaluate(
    (_electron, [url, file]) => {
      (globalThis as unknown as { __e2e: { routes: { [url: string]: string } } }).__e2e.routes[
        url
      ] = file;
    },
    [url, file] as const
  );
}

/** The next native open dialog picks `file`. */
export function stubOpenFile(app: ElectronApplication, file: string) {
  return app.evaluate(({ dialog }, file) => {
    const previous = dialog.showOpenDialog;
    dialog.showOpenDialog = (async () => {
      dialog.showOpenDialog = previous;
      return { canceled: false, filePaths: [file] };
    }) as typeof dialog.showOpenDialog;
  }, file);
}

/** The repo's scripted UCI engine (streams `info` lines on `go infinite`), run by this Node. */
export const FAKE_ENGINE = join(desktopDir, "src/main/engine/__fixtures__/fake-live-uci.mjs");

/**
 * Registers the fake engine as the default, through the preload bridge (the Settings form needs a
 * native file picker; this is set-up, not the journey). Its log of UCI commands goes to `logFile`;
 * `mode` is the script's own (e.g. "lines": lines that fit the position, see the script).
 */
export function registerFakeEngine(page: Page, logFile: string, mode?: string) {
  return page.evaluate(
    ([executablePath, script, log, mode]) => {
      const api = (window as unknown as { chaturanga: ChaturangaApi }).chaturanga;
      return api.engines.create({
        name: "Fake UCI",
        executablePath,
        args: mode ? [script, log, mode] : [script, log],
        isDefault: true
      });
    },
    [process.execPath, FAKE_ENGINE, logFile, mode ?? ""] as const
  );
}

/** Imports a PGN file through the sidebar's Import PGN (its native picker stubbed to `file`). */
export async function importPgnFile(
  app: ElectronApplication,
  page: Page,
  file: string
): Promise<void> {
  await stubOpenFile(app, file);
  await sidebar(page).getByRole("button", { name: "Import PGN", exact: true }).click();
}

/** Leaves the first-run welcome through "Skip setup". */
export async function skipWelcome(page: Page): Promise<void> {
  const welcome = page.getByRole("dialog", { name: "Welcome to Chaturanga" });
  await expect(welcome).toBeVisible({ timeout: 30_000 });
  await welcome.getByRole("button", { name: "Skip setup" }).click();
  await expect(welcome).toBeHidden();
}

export const sidebar = (page: Page) =>
  page.getByRole("navigation", { name: "Application actions" });

/** The square's centre on the visible board (white at the bottom unless `flipped`). */
export async function clickSquare(page: Page, square: string, flipped = false): Promise<void> {
  const board = page.getByRole("region", { name: "Board" }).locator("cg-board");
  const box = await board.boundingBox();
  if (!box) throw new Error("board not visible");
  const file = square.charCodeAt(0) - 97;
  const rank = Number(square[1]) - 1;
  const column = flipped ? 7 - file : file;
  const row = flipped ? rank : 7 - rank;
  const x = box.x + ((column + 0.5) * box.width) / 8;
  const y = box.y + ((row + 0.5) * box.height) / 8;
  // A page that is fading out (route transitions) can still sit on top of the board: wait until
  // the board is what a click there would hit.
  await expect
    .poll(() =>
      page.evaluate(([x, y]) => Boolean(document.elementFromPoint(x, y)?.closest("cg-container")), [
        x,
        y
      ] as const)
    )
    .toBe(true);
  await page.mouse.click(x, y);
}

/**
 * Quits the app and waits for it to exit, which takes well under a second. One that hasn't exited
 * after `timeoutMs` is stuck quitting: it is killed with its child processes (on Windows that takes
 * `taskkill /T`: killing only the main process there leaves its helpers running and holding the
 * profile's files), and the test fails, so a quit that hangs is reported rather than waited out.
 */
export async function closeApp(app: ElectronApplication, timeoutMs = 10_000): Promise<void> {
  const closed = app.close().then(
    () => true,
    () => true
  );
  let timer: NodeJS.Timeout | undefined;
  const timedOut = new Promise<false>(
    (resolve) => (timer = setTimeout(() => resolve(false), timeoutMs))
  );
  const exited = await Promise.race([closed, timedOut]);
  clearTimeout(timer);
  if (exited) return;
  const pid = app.process().pid;
  if (process.platform === "win32" && pid !== undefined) {
    spawnSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore" });
  } else {
    app.process().kill("SIGKILL");
  }
  await closed;
  throw new Error(`The app hadn't exited ${timeoutMs / 1000} s after quitting, so it was killed.`);
}

/**
 * Deletes a used profile. On Windows a just-closed app's helper processes (crash reporter, GPU) can
 * hold its files for a moment, so it is retried for a few seconds; a profile still locked after
 * that is left in the temp folder with a warning, not reported as the test failing.
 */
function removeProfile(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (error) {
    console.warn(`Couldn't delete the e2e profile ${dir}: ${(error as Error).message}`);
  }
}

type Fixtures = {
  /** A fresh profile directory, deleted after the test. */
  profile: string;
  /** Launches the app on a profile (the test's own by default); every launch is closed afterwards. */
  launch: (profile?: string) => Promise<LaunchedApp>;
};

export const test = base.extend<Fixtures>({
  // eslint-disable-next-line no-empty-pattern
  profile: async ({}, provide) => {
    // The long form of the path: Windows' temp folder can be a short 8.3 name (RUNNER~1).
    const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "chaturanga-e2e-")));
    await provide(dir);
    removeProfile(dir);
  },
  launch: async ({ profile }, provide, testInfo) => {
    const launched: LaunchedApp[] = [];
    await provide(async (dir = profile) => {
      const app = await launchApp(dir);
      launched.push(app);
      return app;
    });
    // Every launch is closed even when one fails to quit; the first failure is reported after.
    let stuck: unknown;
    for (const [index, { app, page }] of launched.entries()) {
      if (testInfo.status !== testInfo.expectedStatus && !page.isClosed()) {
        await testInfo.attach(`screen-${index}`, {
          body: await page.screenshot().catch(() => Buffer.alloc(0)),
          contentType: "image/png"
        });
      }
      await closeApp(app).catch((error: unknown) => (stuck ??= error));
    }
    if (stuck) throw stuck;
    for (const { pageErrors } of launched)
      expect(pageErrors, "uncaught errors in the window").toEqual([]);
  }
});

export { expect };
