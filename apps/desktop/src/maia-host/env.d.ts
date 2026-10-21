import type { MaiaHostBridge } from "./protocol";

declare global {
  interface Window {
    /** The host preload's bridge to main (src/preload/maia-host.ts). */
    readonly maiaHost: MaiaHostBridge;
  }
}
