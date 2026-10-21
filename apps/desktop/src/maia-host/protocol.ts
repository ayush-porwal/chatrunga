/**
 * Constants and the preload bridge for the hidden Maia host page (./main.ts), which runs CSSLab's
 * Maia 3 engine unmodified (vendor/csslab-maia), and main's client for it
 * (main/maia/maia-host.ts). The messages themselves are @chaturanga/shared/engine/maia3's.
 */
import type { MaiaHostMessage } from "@chaturanga/shared/engine/maia3-host";

/** The host page's origin: a privileged scheme served only to the host window's own session. */
export const MAIA_HOST_SCHEME = "chaturanga-maia";
export const MAIA_HOST_ORIGIN = `${MAIA_HOST_SCHEME}://host`;
/** Where CSSLab's worker fetches the model from (their path, kept so their code runs as is). */
export const MAIA_MODEL_URL_PATH = "/maia3/maia3_simplified.onnx";
/** The ipc channel main sends the host its end of the MessageChannel on. */
export const MAIA_HOST_PORT_CHANNEL = "maia-host:port";

/** CSSLab's `MaiaStatus` (their src/types/engine.ts). */
export type MaiaHostStatus = Extract<MaiaHostMessage, { type: "status" }>["status"];

/** What the host preload exposes to the host page as `window.maiaHost`. */
export interface MaiaHostBridge {
  /** Registers the page's handler for main's requests (once; data, still to be checked). */
  listen(onRequest: (request: unknown) => void): void;
  /** Sends a message to main (queued until main's port has arrived). */
  post(message: MaiaHostMessage): void;
}
