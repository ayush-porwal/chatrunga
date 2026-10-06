import { afterEach, describe, expect, it, vi } from "vitest";
import type { ChaturangaApi } from "@chaturanga/shared/ipc/chaturanga-api";
import type { ChesscomAccount, ChesscomEvent } from "@chaturanga/shared/types/chesscom";
import { useChesscomStore } from "../stores/chesscom-store";
import { startChesscomSync } from "./useChesscom";

const ACCOUNT: ChesscomAccount = {
  id: "ayush_p64",
  username: "ayush_p64",
  title: null,
  ratings: { rapid: 1684 },
  connectedAt: 1,
  lastSyncAt: null
};

function bridge(account: ChesscomAccount | null) {
  let emit: (event: ChesscomEvent) => void = () => undefined;
  const api = {
    status: vi.fn(async () => ({ account, connecting: false })),
    connect: vi.fn(),
    disconnect: vi.fn(),
    syncGames: vi.fn(async () => ({ imported: 0, skipped: 0 }))
  } satisfies ChaturangaApi["chesscom"];
  const events = {
    onChesscomEvent: (callback: (event: ChesscomEvent) => void) => {
      emit = callback;
      return () => {
        emit = () => undefined;
      };
    }
  };
  return { api, events, emit: (event: ChesscomEvent) => emit(event) };
}

afterEach(() => {
  useChesscomStore.setState({
    status: { account: null, connecting: false },
    loaded: false,
    sync: { running: false, imported: 0, error: null }
  });
});

describe("startChesscomSync", () => {
  it("reads the account on open and imports new games when one is connected", async () => {
    const { api, events } = bridge(ACCOUNT);
    const stop = startChesscomSync({ api, events, refreshGames: vi.fn() });
    await vi.waitFor(() => expect(api.syncGames).toHaveBeenCalledTimes(1));
    expect(useChesscomStore.getState()).toMatchObject({
      loaded: true,
      status: { account: ACCOUNT }
    });
    stop();
  });

  it("doesn't import without an account", async () => {
    const { api, events } = bridge(null);
    const stop = startChesscomSync({ api, events, refreshGames: vi.fn() });
    await vi.waitFor(() => expect(useChesscomStore.getState().loaded).toBe(true));
    expect(api.syncGames).not.toHaveBeenCalled();
    stop();
  });

  it("follows the import's progress, and re-reads the library once games came in", async () => {
    const { api, events, emit } = bridge(null);
    const refreshGames = vi.fn();
    const stop = startChesscomSync({ api, events, refreshGames });
    emit({ type: "sync", running: true, imported: 12, error: null });
    expect(useChesscomStore.getState().sync).toEqual({ running: true, imported: 12, error: null });
    expect(refreshGames).not.toHaveBeenCalled();
    emit({ type: "sync", running: false, imported: 30, error: null });
    expect(refreshGames).toHaveBeenCalledTimes(1);
    emit({ type: "status", status: { account: ACCOUNT, connecting: false } });
    expect(useChesscomStore.getState().status.account).toEqual(ACCOUNT);
    stop();
  });
});
