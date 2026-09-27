import { app, safeStorage, shell } from "electron";
import { join } from "node:path";
import { gameRepository } from "../db/repositories";
import { LichessAccountStore } from "./account-store";
import { LichessService } from "./lichess-service";

let service: LichessService | null = null;

export function getLichessService(): LichessService {
  if (!service) {
    service = new LichessService({
      store: new LichessAccountStore(
        join(app.getPath("userData"), "lichess-account.json"),
        safeStorage
      ),
      games: gameRepository,
      openExternal: (url) => shell.openExternal(url)
    });
  }
  return service;
}

/** App quit: closes Lichess connections, if the service was ever used. */
export function shutdownLichess(): void {
  service?.shutdown();
}
