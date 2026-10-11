import { useState } from "react";
import { Sparkles } from "lucide-react";
import { BoardThumbnail } from "../settings/board-thumbnail";
import type { OnboardingStep } from "./onboarding-state";
import { operaGameMoment } from "./opera-game";

type StageSpec = { ply: number; note: string };

/** The game's title, under the board on every step. */
const GAME_CAPTION = "Morphy vs Duke Karl and Count Isouard, Paris 1858";

/** The Opera game moment the board shows on each step, with the coach's note on that move. */
const stages: Record<OnboardingStep, StageSpec> = {
  welcome: {
    ply: 31,
    note: "Morphy gives up his queen. After Nxb8, Rd8 is mate: the rook checks and the bishop on g5 covers e7."
  },
  engines: {
    ply: 13,
    note: "A double attack. With the bishop on c4 the queen hits f7, and it eyes the loose pawn on b7 as well."
  },
  level: {
    ply: 23,
    note: "Castling long puts the rook on the open d-file at once, lined up against the pinned knight on d7."
  },
  coach: {
    ply: 19,
    note: "A knight for two pawns, to get at the black king while it is still in the centre. Every white piece joins in."
  },
  done: {
    ply: 33,
    note: "Checkmate. The bishop on g5 guards the rook and covers e7; Black’s own pieces take every other square."
  }
};

/**
 * The illustration: board, caption, coach note. One column wide: the board, the caption and the
 * note card share both edges. A new position fades in over the previous one (the board never
 * blinks empty); reduced motion swaps it at once.
 */
export function Stage({ step }: { step: OnboardingStep }) {
  const { ply, note } = stages[step];
  const moment = operaGameMoment(ply);
  const [previousPly, setPreviousPly] = useState(ply);
  const [shownPly, setShownPly] = useState(ply);
  if (ply !== shownPly) {
    setPreviousPly(shownPly);
    setShownPly(ply);
  }
  const previous = operaGameMoment(previousPly);

  return (
    <figure
      aria-label="Illustration: Morphy’s Opera game"
      className="grid min-h-0 min-w-0 grid-rows-[424px_auto_minmax(0,1fr)]"
    >
      <div data-slot="onb-board" className="relative size-[424px]">
        {previousPly !== ply ? (
          <BoardThumbnail
            fen={previous.fen}
            lastMove={previous.uci}
            rounded="xl"
            className="absolute inset-0"
          />
        ) : null}
        <div key={ply} className="onb-board-in absolute inset-0">
          <BoardThumbnail
            fen={moment.fen}
            lastMove={moment.uci}
            rounded="xl"
            label={`Board after ${moment.label}`}
          />
        </div>
      </div>
      <figcaption
        data-slot="onb-caption"
        className="mt-3 truncate text-xs leading-5 text-fg-subtle"
      >
        {GAME_CAPTION}
      </figcaption>
      <div
        data-slot="onb-note"
        aria-hidden
        className="mt-4 grid min-h-0 content-start gap-2 overflow-hidden rounded-xl border border-line bg-surface p-4"
      >
        <div key={step} className="onb-note-in grid gap-2">
          <div className="flex h-6 items-center gap-2">
            <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent-soft text-accent">
              <Sparkles className="size-3.5" />
            </span>
            <span className="font-mono text-sm font-semibold text-fg">{moment.label}</span>
            <span className="ml-auto text-2xs text-fg-subtle">Coach</span>
          </div>
          <p className="font-serif text-[0.9375rem] leading-6 text-fg-secondary">{note}</p>
        </div>
      </div>
    </figure>
  );
}
