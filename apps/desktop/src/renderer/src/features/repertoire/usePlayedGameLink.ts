import { useEffect, useMemo } from "react";
import type { LinkGameInput } from "@chaturanga/shared/types/repertoire";
import { useEventCallback } from "@/lib/use-event-callback";
import { flushGameAutosave } from "../../app/useGameAutosave";
import { useLinkGameMutation } from "../../queries/repertoire";
import { useGameStore } from "../../stores/game-store";
import { useRepertoireHandoffStore } from "../../stores/repertoire-handoff-store";
import { useSaveStatusStore } from "../../stores/save-status-store";
import { createLinkOnce } from "./handoffs";

/**
 * Links an engine game played from a repertoire (Play from here) to that repertoire as a
 * `played` game, once, after autosave has written it to the library. Follows the game store: the
 * handoff ends when another board replaces it, and binds to the library id the game's first save
 * gives it. A save that failed is linked when its retry succeeds. Mount once (App).
 */
export function usePlayedGameLink(): void {
  const { mutateAsync } = useLinkGameMutation();
  const link = useEventCallback((input: LinkGameInput) => mutateAsync(input));
  const linkOnce = useMemo(() => createLinkOnce(link), [link]);

  useEffect(() => {
    const handoff = () => useRepertoireHandoffStore.getState();

    const tryLink = async () => {
      const played = handoff().played;
      const gameId = played?.gameId;
      const api = window.chaturanga?.repertoires;
      if (!played || !gameId || typeof api?.linkGame !== "function") return;
      // The game must be in the library first: wait for its write (a failure retries later).
      await flushGameAutosave();
      const failures = useSaveStatusStore.getState().failures;
      if (failures.some((failure) => failure.gameId === gameId)) return;
      if (handoff().played?.gameId !== gameId) return;
      await linkOnce({
        repertoireId: played.repertoireId,
        chapterId: played.chapterId,
        gameId,
        gameNodeId: played.gameNodeId,
        kind: "played",
        capturedPath: played.capturedPath
      });
    };

    const unsubscribers = [
      useGameStore.subscribe((state, previous) => {
        const played = handoff().played;
        if (!played?.onBoard) return;
        // Another board replaced the game (same rule as autosave: headers and tree change together).
        if (state.headers !== previous.headers && state.moveTree !== previous.moveTree) {
          handoff().leaveBoard();
          return;
        }
        if (state.gameId && state.gameId !== previous.gameId && !played.gameId) {
          handoff().bindGame(state.gameId);
          void tryLink();
        }
      }),
      useSaveStatusStore.subscribe((state, previous) => {
        const gameId = handoff().played?.gameId;
        if (!gameId) return;
        const failed = (failures: typeof state.failures) =>
          failures.some((failure) => failure.gameId === gameId);
        if (failed(previous.failures) && !failed(state.failures)) void tryLink();
      })
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [linkOnce]);
}
