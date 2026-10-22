import { contextBridge, ipcRenderer } from "electron";
import type { MaiaHostMessage } from "@chaturanga/shared/engine/maia3-host";
import { MAIA_HOST_PORT_CHANNEL, type MaiaHostBridge } from "../maia-host/protocol";

// The Maia host window's preload (main/maia/maia-host.ts). Runs sandboxed: only `electron`'s
// renderer modules are available here. It holds main's end of the MessageChannel and gives the
// host page two calls on it, nothing else.

let port: MessagePort | null = null;
let onRequest: ((request: unknown) => void) | null = null;
/** What the page posted before main's port arrived. */
const outbox: MaiaHostMessage[] = [];

function connect(): void {
  if (!port || !onRequest) return;
  const deliver = onRequest;
  port.addEventListener("message", (event: { data: unknown }) => deliver(event.data));
  port.start();
}

ipcRenderer.once(MAIA_HOST_PORT_CHANNEL, (event) => {
  const received = event.ports.at(0);
  if (!received) return;
  port = received;
  for (const message of outbox.splice(0)) port.postMessage(message);
  connect();
});

const bridge: MaiaHostBridge = {
  listen(listener) {
    if (onRequest) return;
    onRequest = listener;
    connect();
  },
  post(message) {
    if (port) port.postMessage(message);
    else outbox.push(message);
  }
};

contextBridge.exposeInMainWorld("maiaHost", bridge);
