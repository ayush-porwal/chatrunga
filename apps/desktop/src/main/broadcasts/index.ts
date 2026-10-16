import { ipcMain } from "electron";
import { broadcast } from "../ipc/broadcast";
import { asString, fail } from "../ipc/fields";
import { BroadcastService } from "./broadcast-service";
import { BROADCAST_ID } from "./normalize";

let service: BroadcastService | null = null;

function getBroadcastService(): BroadcastService {
  service ??= new BroadcastService();
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
}

/** App quit: closes the round streams, if any were opened. */
export function shutdownBroadcasts(): void {
  service?.shutdown();
}
