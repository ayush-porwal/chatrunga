import { useMemo, useState } from "react";
import { ChevronRight, Search, Upload } from "lucide-react";
import type { GameSummary } from "@chaturanga/shared/types/chess";
import { Button } from "@/components/ui/button";
import { useGamesQuery } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import { cn } from "@/lib/utils";
import { listRowInteractive, listRowSelected } from "@/lib/ui";
import { Dialog } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Eyebrow } from "@/components/ui/page";

type GameReviewPickerProps = {
  onClose: () => void;
  onSelect: (gameId: string) => void;
  onImport: () => void;
};

type CurrentGame = {
  id: string | null;
  white: string | null;
  black: string | null;
  result: string | null;
  event: string | null;
  moveCount: number;
};

function titleFor(game: Pick<GameSummary, "white" | "black">): string {
  return `${game.white || "White"} vs ${game.black || "Black"}`;
}

function subtitleFor(game: Pick<GameSummary, "event" | "result" | "date">): string {
  return [game.event || "Imported game", game.result || "*", game.date].filter(Boolean).join(" · ");
}

export function GameReviewPicker({ onClose, onSelect, onImport }: GameReviewPickerProps) {
  const games = useGamesQuery();
  const currentGameId = useGameStore((state) => state.gameId);
  const currentWhite = useGameStore((state) => state.headers.white);
  const currentBlack = useGameStore((state) => state.headers.black);
  const currentResult = useGameStore((state) => state.headers.result);
  const currentEvent = useGameStore((state) => state.headers.event);
  const currentMoveCount = useGameStore((state) => Math.max(0, state.moveTree.length - 1));
  const currentGame: CurrentGame = {
    id: currentGameId,
    white: currentWhite ?? null,
    black: currentBlack ?? null,
    result: currentResult ?? null,
    event: currentEvent ?? null,
    moveCount: currentMoveCount
  };
  const [query, setQuery] = useState("");

  const filteredGames = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const savedGames = (games.data ?? []).filter((game) => game.id !== currentGameId);
    if (!needle) return savedGames;
    return savedGames.filter((game) =>
      [game.white, game.black, game.event, game.date, game.result]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(needle))
    );
  }, [currentGameId, games.data, query]);

  const currentCanReview = currentGame.moveCount > 0;
  const currentLabel = currentGame.white || currentGame.black ? titleFor(currentGame) : "Current game";
  const currentSubtitle = currentCanReview
    ? [currentGame.event, currentGame.result, `${currentGame.moveCount} plies`].filter(Boolean).join(" · ")
    : "";

  const hasSavedGames = (games.data ?? []).some((game) => game.id !== currentGameId);

  return (
    <Dialog
      title="Choose a game"
      description="Reviews use the game’s main line."
      onClose={onClose}
      bodyClassName="flex min-h-0 flex-1 flex-col gap-3"
      footer={
        <Button type="button" variant="outline" size="sm" onClick={() => { onClose(); onImport(); }}>
          <Upload />Import PGN
        </Button>
      }
    >
      {hasSavedGames || query ? (
        <div className="relative shrink-0">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Search saved games"
            placeholder="Search players, event, date or result"
            className="pl-9"
          />
        </div>
      ) : null}

      <div className="scroll-area -mr-1 grid min-h-0 flex-1 content-start gap-4 overflow-y-auto pr-1">
        {currentCanReview ? (
          <section className="grid gap-2">
            <Eyebrow>Current game</Eyebrow>
            <GameRow title={currentLabel} meta={currentSubtitle} selected onClick={() => onSelect("current")} />
          </section>
        ) : null}

        <section className="grid gap-2">
          <div className="flex items-center justify-between gap-2">
            <Eyebrow>Saved games</Eyebrow>
            {games.isLoading ? <span className="text-2xs text-fg-subtle">Loading…</span> : null}
          </div>
          {games.isError ? <Notice tone="warn">Saved games could not be loaded. Try opening Game review again.</Notice> : null}
          {filteredGames.length ? (
            <div className="grid gap-1.5">
              {filteredGames.map((game) => (
                <GameRow key={game.id} title={titleFor(game)} meta={subtitleFor(game)} onClick={() => onSelect(game.id)} />
              ))}
            </div>
          ) : games.isLoading ? null : (
            <EmptyState
              compact
              title={query ? "No saved games match this search." : currentCanReview ? "No other saved games." : "No saved games yet — import a PGN or play a game first."}
            />
          )}
        </section>
      </div>
    </Dialog>
  );
}

function GameRow({ title, meta, selected = false, onClick }: { title: string; meta: string; selected?: boolean; onClick: () => void }) {
  return (
    <button type="button" className={cn(listRowInteractive, "group", selected && listRowSelected)} onClick={onClick}>
      <span className="grid min-w-0 flex-1 gap-0.5">
        <span className="truncate font-medium text-fg">{title}</span>
        <span className="truncate text-xs text-fg-muted">{meta}</span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-subtle transition-transform group-hover:translate-x-0.5 group-hover:text-fg" />
    </button>
  );
}
