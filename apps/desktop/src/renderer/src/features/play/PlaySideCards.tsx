import { memo, useState, type JSX } from "react";
import { Check, ChevronRight, UserPlus } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { LichessChallenge } from "@chaturanga/shared/types/lichess";
import { Button } from "@/components/ui/button";
import { SideDot } from "@/components/ui/side-dot";
import { cn } from "@/lib/utils";
import { DESTINATION_ICONS } from "../../app/destination-icons";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { lichessErrorMessage, playerLabel } from "../lichess/lichess-game";
import { CardTitleBar } from "./card-title";
import { PieceArt } from "./piece-art";

/** The side column's card shell: the same title bar and hairline as the Recent games table. */
const sideCard = "flex min-w-0 flex-col overflow-hidden rounded-xl border border-line bg-surface";
const titleRule = "border-b border-line-subtle";

/** Play's "Start something new": Analyze position, Solve puzzles, Import PGN. */
export const StartSomethingNewCard = memo(function StartSomethingNewCard({
  desktopApiAvailable,
  onAnalyze,
  onPuzzles,
  onImportPgn
}: {
  desktopApiAvailable: boolean;
  onAnalyze: () => void;
  onPuzzles: () => void;
  onImportPgn: () => void;
}): JSX.Element {
  const rows: Array<{ icon: LucideIcon; label: string; onClick: () => void }> = [
    { icon: DESTINATION_ICONS.analyze, label: "Analyze position", onClick: onAnalyze },
    { icon: DESTINATION_ICONS.puzzles, label: "Solve puzzles", onClick: onPuzzles },
    { icon: DESTINATION_ICONS.importPgn, label: "Import PGN", onClick: onImportPgn }
  ];
  return (
    <section aria-labelledby="play-start-new-title" className={cn(sideCard, "shrink-0")}>
      <CardTitleBar id="play-start-new-title" title="Start something new" className={titleRule} />
      <div className="grid p-1.5">
        {rows.map(({ icon: Icon, label, onClick }) => (
          <button
            key={label}
            type="button"
            // Each of them needs the desktop app (engines, local databases, the file picker).
            disabled={!desktopApiAvailable}
            onClick={onClick}
            className="group flex items-center gap-3 rounded-[9px] px-2.5 py-2 text-left text-fg-secondary outline-none transition-colors duration-micro hover:bg-control hover:text-fg focus-visible:ring-2 focus-visible:ring-accent/50 disabled:pointer-events-none disabled:opacity-50"
          >
            <span className="grid size-8.5 shrink-0 place-items-center rounded-[9px] bg-control text-fg-secondary inset-ring inset-ring-line-strong [&>svg]:size-4.25">
              <Icon aria-hidden="true" />
            </span>
            <span className="min-w-0 flex-1 truncate text-[0.84375rem] font-medium">{label}</span>
            <ChevronRight className="size-3.75 shrink-0 text-fg-subtle" aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
});

/**
 * Play's "Challenges for you": each incoming Lichess challenge as an inner card (who, clock,
 * rated, your colour; Accept / Decline). With none, a black king says so ("Account not connected"
 * without a Lichess account).
 */
export const ChallengesCard = memo(function ChallengesCard(): JSX.Element {
  const loaded = useLichessStore((state) => state.loaded);
  const connected = useLichessStore(
    (state) => Boolean(state.status.account) && !state.status.tokenRejected
  );
  const challenges = useLichessStore((state) => state.challenges);
  const liveGame = useLichessStore(selectLiveGameInProgress);
  const incoming = connected ? challenges.filter((item) => item.direction === "in") : [];
  // Outside the desktop app the account never loads: it isn't connected.
  const settled = loaded || !window.chaturanga;

  return (
    <section aria-labelledby="play-challenges-title" className={cn(sideCard, "shrink-0")}>
      <CardTitleBar
        id="play-challenges-title"
        title="Challenges for you"
        count={incoming.length}
        className={titleRule}
      />
      {incoming.length ? (
        <ul className="grid gap-2.5 p-2.5">
          {incoming.map((challenge) => (
            <ChallengeItem key={challenge.id} challenge={challenge} acceptDisabled={liveGame} />
          ))}
        </ul>
      ) : (
        <div className="grid flex-1 place-items-center py-4">
          {settled ? (
            <div className="flex flex-col items-center gap-2">
              <PieceArt
                color="black"
                piece="king"
                className="size-24 drop-shadow-[0_6px_8px_rgb(0_0_0/0.4)]"
                style={{ transform: "rotate(-8deg)" }}
              />
              <span className="text-[0.8125rem] font-medium text-fg-muted">
                {connected ? "No challenges" : "Account not connected"}
              </span>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
});

function ChallengeItem({
  challenge,
  acceptDisabled
}: {
  challenge: LichessChallenge;
  /** A Lichess game is being played: another can't start. */
  acceptDisabled: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const clock = challenge.timeControl
    ? `${challenge.timeControl.minutes}+${challenge.timeControl.incrementSec}`
    : "Unlimited";

  function answer(action: "acceptChallenge" | "declineChallenge") {
    const api = window.chaturanga?.lichess;
    if (!api) return;
    setBusy(true);
    setError(null);
    // Accepted: the game starts through the Lichess event stream (useLichess).
    api[action](challenge.id)
      .then(() => useLichessStore.getState().removeChallenge(challenge.id))
      .catch((reason: unknown) => {
        setBusy(false);
        setError(
          lichessErrorMessage(
            reason,
            action === "acceptChallenge"
              ? "Couldn’t accept the challenge."
              : "Couldn’t decline the challenge."
          )
        );
      });
  }

  return (
    <li className="grid gap-2.5 rounded-[10px] border border-line bg-surface-sunken p-3">
      <div className="flex items-center gap-2.5">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-control text-fg-secondary [&>svg]:size-4">
          <UserPlus aria-hidden="true" />
        </span>
        <span className="grid min-w-0 flex-1 leading-[1.3]">
          <span className="truncate text-sm font-semibold text-fg">
            {playerLabel(challenge.opponent)}
          </span>
          {challenge.opponent.rating ? (
            <span className="text-xs tabular-nums text-fg-subtle">{challenge.opponent.rating}</span>
          ) : null}
        </span>
      </div>
      <div className="flex items-center gap-2.5 text-[0.78125rem] text-fg-muted">
        <span className="rounded-md bg-accent-soft px-2 py-0.5 font-semibold tabular-nums text-accent-fg">
          {clock}
        </span>
        <span>{challenge.rated ? "Rated" : "Casual"}</span>
        {challenge.yourColor === "random" ? (
          <span>Random</span>
        ) : (
          <span className="flex items-center gap-1.25">
            <SideDot color={challenge.yourColor} />
            {challenge.yourColor === "white" ? "White" : "Black"}
          </span>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto] gap-1.5">
        <Button
          type="button"
          variant="primary"
          size="sm"
          className="h-7.5 text-[0.8125rem]"
          disabled={busy || acceptDisabled}
          onClick={() => answer("acceptChallenge")}
        >
          <Check />
          Accept
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-7.5 text-[0.8125rem]"
          disabled={busy}
          onClick={() => answer("declineChallenge")}
        >
          Decline
        </Button>
      </div>
      {error ? (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
    </li>
  );
}
