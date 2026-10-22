import { open, readFile, stat, type FileHandle } from "node:fs/promises";
import { join } from "node:path";
import {
  BrowserWindow,
  MessageChannelMain,
  session,
  type MessagePortMain,
  type Session
} from "electron";
import {
  Maia3UnavailableError,
  type Maia3Evaluator,
  type Maia3Output,
  type Maia3Query
} from "@chaturanga/shared/engine/maia3";
import {
  parseMaiaHostMessage,
  validMaia3Output,
  type MaiaHostMessage,
  type MaiaHostRequest
} from "@chaturanga/shared/engine/maia3-host";
import {
  MAIA_HOST_ORIGIN,
  MAIA_HOST_PORT_CHANNEL,
  MAIA_HOST_SCHEME
} from "../../maia-host/protocol";
import { markServiceWindow } from "../app-windows";
import { errorMessage, logger } from "../logger";
import { maiaHostHeaders, maiaHostTarget } from "./host-files";

/** The host's own session, kept in memory (no `persist:` prefix): nothing of it is written. */
const MAIA_HOST_PARTITION = "maia-host";
const READY_TIMEOUT_MS = 120_000;
const REQUEST_TIMEOUT_MS = 30_000;
const MODEL_CHUNK_BYTES = 1 << 20;

type Priority = "game" | "review";

interface Job {
  queries: readonly Maia3Query[];
  priority: Priority;
  resolve: (outputs: Maia3Output[]) => void;
  reject: (error: Error) => void;
  /** Detaches the abort listener (once the job has settled). */
  release: () => void;
  settled: boolean;
}

/** One host window and the channel to it; replaced whole when it goes. */
interface Host {
  window: BrowserWindow;
  port: MessagePortMain;
  ready: boolean;
  readyTimer: NodeJS.Timeout;
}

interface Running {
  id: number;
  job: Job;
  timer: NodeJS.Timeout;
}

/** Where the host's build is. */
export interface MaiaHostFiles {
  /** The host page build (out/maia-host). */
  hostDir: string;
  /** The host window's preload (out/preload/maia-host.cjs). */
  preload: string;
}

export interface MaiaHostOptions extends MaiaHostFiles {
  /** The Maia 3 model file on disk, or null while it isn't installed. */
  modelPath: () => string | null;
}

function settle(job: Job, outcome: { outputs: Maia3Output[] } | { error: Error }): void {
  if (job.settled) return;
  job.settled = true;
  job.release();
  if ("outputs" in outcome) job.resolve(outcome.outputs);
  else job.reject(outcome.error);
}

/** The outputs for `queries`, each checked against its position; null if any doesn't fit. */
function checkedOutputs(
  queries: readonly Maia3Query[],
  result: Maia3Output[]
): Maia3Output[] | null {
  if (result.length !== queries.length) return null;
  const outputs: Maia3Output[] = [];
  for (const [index, query] of queries.entries()) {
    const output = validMaia3Output(query.fen, result[index]);
    if (!output) return null;
    outputs.push(output);
  }
  return outputs;
}

/** The model file as a stream (CSSLab's worker reads the download in chunks). */
function fileStream(path: string): ReadableStream<Uint8Array> {
  let handle: FileHandle | null = null;
  const close = () => handle?.close().catch(() => undefined);
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        handle ??= await open(path, "r");
        const chunk = new Uint8Array(MODEL_CHUNK_BYTES);
        const { bytesRead } = await handle.read(chunk, 0, MODEL_CHUNK_BYTES, null);
        if (bytesRead > 0) {
          controller.enqueue(chunk.subarray(0, bytesRead));
          return;
        }
        await close();
        controller.close();
      } catch (error) {
        await close();
        controller.error(error);
      }
    },
    cancel: async () => {
      await close();
    }
  });
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("The Maia request was aborted.");
}

/**
 * Runs CSSLab's Maia 3 engine (vendor/csslab-maia, unmodified) in a hidden, sandboxed window of
 * its own (src/maia-host), opened on the first request. Requests go one at a time over a
 * MessageChannel, a game's ahead of a review's, with ids and timeouts; answers are checked against
 * their positions before they are returned. A host that crashes, fails or stops answering is
 * closed (failing what is waiting), and the next request opens a fresh one.
 */
export class MaiaHost implements Maia3Evaluator {
  private host: Host | null = null;
  private readonly queue: Job[] = [];
  private running: Running | null = null;
  private nextId = 1;
  private configured = false;

  constructor(private readonly options: MaiaHostOptions) {}

  isInstalled(): boolean {
    return this.options.modelPath() !== null;
  }

  evaluate(
    queries: readonly Maia3Query[],
    options: { priority?: Priority; signal?: AbortSignal } = {}
  ): Promise<Maia3Output[]> {
    if (!this.isInstalled())
      return Promise.reject(new Maia3UnavailableError("The Maia 3 model isn't installed."));
    if (queries.length === 0) return Promise.resolve([]);
    const { signal, priority = "review" } = options;
    if (signal?.aborted) return Promise.reject(abortError(signal));
    return new Promise((resolve, reject) => {
      const job: Job = {
        queries,
        priority,
        resolve,
        reject,
        release: () => undefined,
        settled: false
      };
      if (signal) {
        // A queued job leaves the queue; a running one is answered now (its result is dropped).
        const onAbort = () => {
          const index = this.queue.indexOf(job);
          if (index >= 0) this.queue.splice(index, 1);
          settle(job, { error: abortError(signal) });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        job.release = () => signal.removeEventListener("abort", onAbort);
      }
      this.enqueue(job);
      this.pump();
    });
  }

  /** Closes the host window (if open); waiting requests fail. The next request opens a new one. */
  dispose(): void {
    if (this.host) this.close(this.host, "The Maia host was closed.", { expected: true });
  }

  /** A game's move goes ahead of every review request, behind earlier game moves. */
  private enqueue(job: Job): void {
    const at =
      job.priority === "game" ? this.queue.findIndex((queued) => queued.priority !== "game") : -1;
    if (at >= 0) this.queue.splice(at, 0, job);
    else this.queue.push(job);
  }

  /** Sends the next job once the host is ready and idle (opening the host if need be). */
  private pump(): void {
    if (this.running || this.queue.length === 0) return;
    const host = this.host ?? this.open();
    if (!host.ready) return;
    const job = this.queue.shift();
    if (!job) return;
    const id = this.nextId++;
    const request: MaiaHostRequest = {
      type: "evaluate",
      id,
      boards: job.queries.map((query) => query.fen),
      eloSelfs: job.queries.map((query) => query.eloSelf),
      eloOppos: job.queries.map((query) => query.eloOppo)
    };
    // A host that doesn't answer is stuck: closing it fails this request (and the waiting ones).
    const timer = setTimeout(
      () => this.close(host, "Maia didn't answer in time."),
      REQUEST_TIMEOUT_MS
    );
    this.running = { id, job, timer };
    host.port.postMessage(request);
  }

  private open(): Host {
    const window = new BrowserWindow({
      show: false,
      skipTaskbar: true,
      focusable: false,
      paintWhenInitiallyHidden: false,
      webPreferences: {
        session: this.hostSession(),
        preload: this.options.preload,
        sandbox: true,
        contextIsolation: true,
        nodeIntegration: false,
        webSecurity: true,
        spellcheck: false,
        // Hidden for good: without this Chromium would throttle its timers and the worker.
        backgroundThrottling: false
      }
    });
    markServiceWindow(window);
    const { port1, port2 } = new MessageChannelMain();
    const readyTimer = setTimeout(
      () => this.close(host, "Maia didn't load in time."),
      READY_TIMEOUT_MS
    );
    const host: Host = { window, port: port1, ready: false, readyTimer };
    this.host = host;

    port1.on("message", (event) => this.onMessage(host, parseMaiaHostMessage(event.data)));
    port1.start();
    window.webContents.once("did-finish-load", () =>
      window.webContents.postMessage(MAIA_HOST_PORT_CHANNEL, null, [port2])
    );
    window.webContents.on("render-process-gone", (_event, details) =>
      this.close(host, `The Maia host stopped (${details.reason}).`)
    );
    window.on("closed", () => this.close(host, "The Maia host was closed."));
    window
      .loadURL(`${MAIA_HOST_ORIGIN}/index.html`)
      .catch((error: unknown) => this.close(host, errorMessage(error)));
    return host;
  }

  private onMessage(host: Host, message: MaiaHostMessage | null): void {
    if (!message || this.host !== host) return;
    switch (message.type) {
      case "status":
        if (message.status === "error") {
          this.close(host, message.error ?? "Maia failed to load.");
        } else if (message.status === "ready" && !host.ready) {
          logger.info("maia", "host ready");
          host.ready = true;
          clearTimeout(host.readyTimer);
          this.pump();
        }
        return;
      case "result":
      case "error":
        this.answer(message);
    }
  }

  /** Settles the running job with its answer (checked first), then sends the next. */
  private answer(message: Extract<MaiaHostMessage, { id: number }>): void {
    const running = this.running;
    if (running?.id !== message.id) return;
    this.running = null;
    clearTimeout(running.timer);
    if (message.type === "error") {
      settle(running.job, { error: new Error(`Maia failed: ${message.message}`) });
    } else {
      const outputs = checkedOutputs(running.job.queries, message.result);
      settle(
        running.job,
        outputs ? { outputs } : { error: new Error("Maia's answer doesn't fit its positions.") }
      );
    }
    this.pump();
  }

  /** Rejects the host's work and tears it down; `expected` (a dispose) logs as info, not a warning. */
  private close(host: Host, reason: string, { expected = false } = {}): void {
    if (this.host !== host) return;
    this.host = null;
    (expected ? logger.info : logger.warn)("maia", `host closed: ${reason}`);
    clearTimeout(host.readyTimer);
    const error = new Maia3UnavailableError(reason);
    if (this.running) {
      clearTimeout(this.running.timer);
      settle(this.running.job, { error });
      this.running = null;
    }
    for (const job of this.queue.splice(0)) settle(job, { error });
    host.port.close();
    if (!host.window.isDestroyed()) host.window.destroy();
  }

  /** The host's session, set up once: its scheme, and no permissions or other requests. */
  private hostSession(): Session {
    const hostSession = session.fromPartition(MAIA_HOST_PARTITION);
    if (this.configured) return hostSession;
    this.configured = true;
    hostSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
    hostSession.setPermissionCheckHandler(() => false);
    hostSession.webRequest.onBeforeRequest((details, callback) =>
      callback({ cancel: !details.url.startsWith(`${MAIA_HOST_ORIGIN}/`) })
    );
    hostSession.protocol.handle(MAIA_HOST_SCHEME, (request) => this.serve(request));
    return hostSession;
  }

  private async serve(request: Request): Promise<Response> {
    const target = maiaHostTarget(request.url, request.method);
    const path =
      target?.kind === "file"
        ? join(this.options.hostDir, target.relativePath)
        : target && this.options.modelPath();
    if (!target || !path) return new Response(null, { status: 404 });
    try {
      // The page's files are small (read whole, from the asar when packaged); the model streams.
      if (target.kind === "file")
        return new Response(new Uint8Array(await readFile(path)), {
          headers: maiaHostHeaders(target.contentType)
        });
      const { size } = await stat(path);
      return new Response(fileStream(path), {
        headers: maiaHostHeaders(target.contentType, size)
      });
    } catch (error) {
      logger.warn("maia", `serving ${target.kind} failed:`, errorMessage(error));
      return new Response(null, { status: 404 });
    }
  }
}
