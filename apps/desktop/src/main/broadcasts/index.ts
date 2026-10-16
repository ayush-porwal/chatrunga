import { BrowserWindow, ipcMain, Notification } from "electron";
import type { BroadcastAlert } from "@chaturanga/shared/types/broadcast";
import { broadcast } from "../ipc/broadcast";
import { getLichessService } from "../lichess";
import { asObject, asString, fail } from "../ipc/fields";
import { BroadcastService } from "./broadcast-service";
import { BROADCAST_ID } from "./normalize";

let service: BroadcastService | null = null;

function getBroadcastService(): BroadcastService {
  // Signed in when the saved Lichess token may read studies (higher limits), else anonymous.
  service ??= new BroadcastService({ getToken: () => getLichessService().broadcastToken() });
  return service;
}

function broadcastId(value: unknown, label: string): string {
  const id = asString(value, label, 8);
  if (!BROADCAST_ID.test(id)) fail(label, "not a Lichess broadcast id");
  return id;
}

/** The finished tournaments' pages (Lichess serves a handful). */
function topPage(value: unknown): number {
  if (value === undefined) return 1;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 20)
    fail("page", "expected a page number from 1 to 20");
  return value;
}

function searchQuery(value: unknown): string {
  const query = asString(value, "search", 100).trim();
  if (!query) fail("search", "empty");
  return query;
}

function broadcastAlert(value: unknown): BroadcastAlert {
  const alert = asObject(value, "alert");
  return { title: asString(alert.title, "title", 120), body: asString(alert.body, "body", 300) };
}

/** The notifications on screen: held until they go, so their click handler isn't collected. */
const shown = new Set<Notification>();

/** Shows `alert` as a desktop notification; clicking it brings the window to the front. */
function notify(alert: BroadcastAlert): void {
  if (!Notification.isSupported()) return;
  const notification = new Notification({ title: alert.title, body: alert.body, silent: false });
  shown.add(notification);
  const forget = () => shown.delete(notification);
  notification.on("close", forget);
  notification.on("failed", forget);
  notification.on("click", () => {
    forget();
    const window = BrowserWindow.getAllWindows().at(0);
    if (!window) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });
  notification.show();
}

/** Lichess broadcasts (public data, no account). Live games go out on `broadcast:event`. */
export function registerBroadcastIpc(): void {
  const broadcasts = getBroadcastService();
  broadcasts.on("event", (event) => broadcast("broadcast:event", event));
  ipcMain.handle("broadcasts:top", (_event, page: unknown) => broadcasts.top(topPage(page)));
  ipcMain.handle("broadcasts:search", (_event, query: unknown) =>
    broadcasts.search(searchQuery(query))
  );
  ipcMain.handle("broadcasts:tournament", (_event, id: unknown) =>
    broadcasts.tournament(broadcastId(id, "tournament id"))
  );
  ipcMain.handle("broadcasts:round", (_event, id: unknown) =>
    broadcasts.round(broadcastId(id, "round id"))
  );
  ipcMain.handle("broadcasts:players", (_event, id: unknown) =>
    broadcasts.players(broadcastId(id, "tournament id"))
  );
  ipcMain.handle("broadcasts:watchRound", (_event, id: unknown) => {
    broadcasts.watchRound(broadcastId(id, "round id"));
  });
  ipcMain.handle("broadcasts:unwatchRound", (_event, id: unknown) =>
    broadcasts.unwatchRound(broadcastId(id, "round id"))
  );
  ipcMain.handle("broadcasts:notify", (_event, alert: unknown) => {
    notify(broadcastAlert(alert));
  });
}

/** App quit: closes the round streams, if any were opened. */
export function shutdownBroadcasts(): void {
  service?.shutdown();
}
