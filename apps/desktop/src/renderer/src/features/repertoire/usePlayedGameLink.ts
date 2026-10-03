import { useEffect, useMemo } from "react";
import type { LinkGameInput } from "@chaturanga/shared/types/repertoire";
import { useEventCallback } from "@/lib/use-event-callback";
import { flushGameAutosave, onGameSaved } from "../../app/useGameAutosave";
import { useLinkGameMutation } from "../../queries/repertoire";
import { useAppNoticeStore } from "../../stores/app-notice-store";
import { useGameStore } from "../../stores/game-store";
import { handoffForSave, useRepertoireHandoffStore } from "../../stores/repertoire-handoff-store";
import { createLinkOnce } from "./handoffs";

/**
 * Links an engine game played from a repertoire (Play from here) to that repertoire as a
 * `played` game once a save of it succeeds: binds the handoff to the library id that save wrote
 * (also when the board was replaced before its first save, which then writes it as it leaves, or
 * another Play from here started before that save was answered),
 * links again when the game's result changes (so the link copies its final headers), and retries
 * a failed link on the game's next save. Closing the window waits for a link still being written.
 * Mount once (App).
 */
export function usePlayedGameLink(): void {
  const { mutateAsync } = useLinkGameMutation();
  const link = useEventCallback((input: LinkGameInput) => mutateAsync(input));
  const linkOnce = useMemo(
    () =>
      createLinkOnce(link, (message) =>
        useAppNoticeStore
          .getState()
          .show(
            `This game couldn't be linked to its repertoire${message ? ` (${message})` : ""}. ` +
              "It's tried again when the game is next saved.",
            { tone: "info" }
          )
      ),
    [link]
  );

  useEffect(() => {
    const handoff = () => useRepertoireHandoffStore.getState();
    const pending = new Set<Promise<boolean>>();

    const unsubscribers = [
      useGameStore.subscribe((state, previous) => {
        // Another board replaced the game (same rule as autosave: headers and tree change together).
        if (
          handoff().played?.onBoard &&
          state.headers !== previous.headers &&
          state.moveTree !== previous.moveTree
        ) {
          handoff().leaveBoard();
        }
      }),
      onGameSaved((saved) => {
        const played = handoffForSave(handoff(), saved);
        if (!played) return;
        if (typeof window.chaturanga?.repertoires?.linkGame !== "function") return;
        handoff().bindGame(saved.gameId, played.board);
        const attempt = linkOnce(
          {
            repertoireId: played.repertoireId,
            chapterId: played.chapterId,
            gameId: saved.gameId,
            gameNodeId: played.gameNodeId,
            kind: "played",
            capturedPath: played.capturedPath
          },
          saved.result
        );
        pending.add(attempt);
        void attempt.finally(() => pending.delete(attempt));
      }),
      // Closing the window: the last save may start a link; wait for it (a failure doesn't block).
      window.chaturanga?.games.onFlushRequest?.(async () => {
        await flushGameAutosave();
        await Promise.all(pending);
        return true;
      }) ?? (() => {})
    ];
    return () => unsubscribers.forEach((unsubscribe) => unsubscribe());
  }, [linkOnce]);
}
