import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, Plus, RotateCcw, Settings } from "lucide-react";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import { MAIA3_RATINGS } from "@chaturanga/shared/engine/maia3";
import type { RepertoireHealthFlag } from "@chaturanga/shared/types/repertoire-health";
import {
  RATING_MODES,
  RATING_MODE_LABELS,
  type RatingMode
} from "@chaturanga/shared/types/ratings";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  CollapsibleBody,
  CollapsibleHeader,
  useCollapsible
} from "@/components/ui/collapsible-section";
import { Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cn } from "@/lib/utils";
import { useExplorerGamesQuery, useExplorerMaiaQuery } from "../../../queries/repertoire-explorer";
import {
  useRepertoireHealthFlags,
  useRepertoireHealthQueueMutation,
  useRepertoireHealthStatus
} from "../../../queries/repertoire-health";
import { useOpenSettings } from "../../settings/settings-link";
import { HEALTH_FLAG_LABELS, healthFlagText } from "../study-from-games";
import { ScoreBar } from "../ScoreBar";
import { moveLabel } from "../study-staging";
import { filtersLine, flagFix, maiaHeading, shouldPrepare } from "./explorer-view";
import { HealthQueueActions, HealthQueueLine } from "./HealthQueue";

/**
 * Study's Explorer tab (docs/repertoire-games-and-practice.md §6): your games, Maia, health.
 */
export type StudyExplorerProps = {
  repertoireId: string;
  /** The selected position. */
  fen: string;
  /** Stages a line from the selected position (UCI moves) in Study's New moves card. */
  onStage: (ucis: string[]) => void;
  /** Opens a flag's position in Study (its Open); without it, flags elsewhere have none. */
  onOpenFlag?: (flag: RepertoireHealthFlag) => void;
};

/** The three sections for the selected position, each folding: games, Maia, health. */
export function StudyExplorer({ repertoireId, fen, onStage, onOpenFlag }: StudyExplorerProps) {
  return (
    <div className="grid content-start gap-1">
      <YourGames repertoireId={repertoireId} fen={fen} onStage={onStage} />
      <LikelyReplies repertoireId={repertoireId} fen={fen} onStage={onStage} />
      <Health repertoireId={repertoireId} fen={fen} onStage={onStage} onOpenFlag={onOpenFlag} />
    </div>
  );
}

function Section({
  id,
  title,
  actions,
  children
}: {
  id: string;
  title: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const section = useCollapsible(`study-explorer:${id}`);
  return (
    <section aria-label={title} className="border-b border-line-subtle pb-2 last:border-b-0">
      <CollapsibleHeader
        open={section.open}
        onToggle={section.toggle}
        controls={section.contentId}
        size="sub"
        actions={actions}
        className="min-h-9"
      >
        {title}
      </CollapsibleHeader>
      <CollapsibleBody section={section} className="grid gap-2">
        {children}
      </CollapsibleBody>
    </section>
  );
}

function SkeletonRows() {
  return (
    <div className="grid gap-1.5" aria-busy="true">
      {[0, 1, 2].map((row) => (
        <Skeleton key={row} className="h-6 w-full" />
      ))}
    </div>
  );
}

function ErrorNotice({
  what,
  error,
  onRetry
}: {
  what: string;
  error: unknown;
  onRetry: () => void;
}) {
  return (
    <Notice
      tone="danger"
      appear={false}
      action={
        <Button type="button" variant="outline" size="xs" onClick={onRetry}>
          <RotateCcw />
          Try again
        </Button>
      }
    >
      Couldn&apos;t read {what}: {ipcErrorMessage(error) || "unknown error"}
    </Notice>
  );
}

function AddButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button type="button" variant="ghost" size="xs" aria-label={label} onClick={onClick}>
      <Plus />
      Add
    </Button>
  );
}

const percent = (share: number) => `${Math.round(share * 100)}%`;

const lastPlayed = (at: number | null) =>
  at === null
    ? ""
    : new Date(at).toLocaleDateString(undefined, { month: "short", year: "numeric" });

/** §6.1: every move of the user's games here, with their score after it. */
function YourGames({ repertoireId, fen, onStage }: Omit<StudyExplorerProps, "onOpenFlag">) {
  const games = useExplorerGamesQuery(repertoireId, fen);
  const data = games.data;
  return (
    <Section id="games" title="Your games">
      {data ? <p className="text-2xs text-fg-subtle">{filtersLine(data.filters)}</p> : null}
      {data?.indexing ? (
        <p className="text-2xs tabular-nums text-fg-muted" role="status">
          Reading your games… {data.indexing.done.toLocaleString()} of{" "}
          {data.indexing.total.toLocaleString()}
        </p>
      ) : null}
      {games.isPending ? <SkeletonRows /> : null}
      {games.isError ? (
        <ErrorNotice what="your games" error={games.error} onRetry={() => void games.refetch()} />
      ) : null}
      {data && !data.moves.length ? (
        <p className="text-xs text-fg-muted">None of your games reached this position.</p>
      ) : null}
      {data?.moves.length ? (
        <table className="w-full text-xs" aria-label="Your games">
          <thead className="text-left text-2xs text-fg-subtle">
            <tr>
              <th className="py-1 font-medium">Move</th>
              <th className="py-1 text-right font-medium">Games</th>
              <th className="py-1 pl-3 font-medium">Your score</th>
              <th className="py-1 font-medium">
                <span className="sr-only">Last played</span>
              </th>
              <th className="py-1">
                <span className="sr-only">Repertoire</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.moves.map((move) => (
              <tr key={move.uci} className="h-8 border-t border-line-subtle">
                <td className="font-mono text-fg">{moveLabel(fen, move.san)}</td>
                <td className="text-right tabular-nums text-fg-secondary">
                  {move.games.toLocaleString()}
                </td>
                <td className="pl-3 text-fg-secondary">
                  <ScoreBar
                    wins={move.wins}
                    draws={move.draws}
                    losses={move.losses}
                    score={move.score === null ? "—" : percent(move.score)}
                  />
                </td>
                <td className="whitespace-nowrap text-2xs text-fg-subtle">
                  {lastPlayed(move.lastPlayedAt)}
                </td>
                <td className="text-right">
                  {move.inRepertoire ? (
                    <Badge tone="accent">In repertoire</Badge>
                  ) : (
                    <AddButton label={`Add ${move.san}`} onClick={() => onStage([move.uci])} />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </Section>
  );
}

/** §6.2: Maia 3's likely moves at a rating and time control. */
function LikelyReplies({ repertoireId, fen, onStage }: Omit<StudyExplorerProps, "onOpenFlag">) {
  const openSettings = useOpenSettings();
  const [rating, setRating] = useState<number | null>(null);
  const [mode, setMode] = useState<RatingMode | null>(null);
  const maia = useExplorerMaiaQuery({ repertoireId, fen, rating, mode });
  const data = maia.data?.installed ? maia.data : null;
  const controls = data ? (
    <>
      <Select
        aria-label="Rating"
        className="h-7 py-0 text-xs"
        value={rating ?? data.defaultRating}
        onChange={(event) => setRating(Number(event.target.value))}
      >
        {MAIA3_RATINGS.map((value) => (
          <option key={value} value={value}>
            {value}
          </option>
        ))}
      </Select>
      <Select
        aria-label="Time control"
        className="h-7 py-0 text-xs"
        value={mode ?? data.mode}
        onChange={(event) => {
          const picked = RATING_MODES.find((value) => value === event.target.value);
          if (picked) setMode(picked);
          // The rating follows the time control until one is picked.
          setRating(null);
        }}
      >
        {RATING_MODES.map((value) => (
          <option key={value} value={value}>
            {RATING_MODE_LABELS[value]}
          </option>
        ))}
      </Select>
    </>
  ) : null;
  return (
    <Section id="maia" title="Likely replies (Maia 3)" actions={controls}>
      {maia.isPending ? <SkeletonRows /> : null}
      {maia.isError ? (
        <ErrorNotice what="Maia's moves" error={maia.error} onRetry={() => void maia.refetch()} />
      ) : null}
      {maia.data && !maia.data.installed ? (
        <p className="flex items-center gap-2 text-xs text-fg-muted">
          <span className="min-w-0 flex-1">Maia 3 isn&apos;t installed.</span>
          {openSettings ? (
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => openSettings("engines")}
            >
              <Settings />
              Open Settings
            </Button>
          ) : null}
        </p>
      ) : null}
      {data ? (
        <>
          <p className="text-2xs text-fg-subtle">{maiaHeading(data.rating, data.opponentToMove)}</p>
          <ul
            className={cn("grid gap-0.5", maia.isPlaceholderData && "opacity-60")}
            aria-label="Likely moves"
          >
            {data.moves.map((move) => (
              <li key={move.uci} className="flex h-8 items-center gap-2 text-xs">
                <span className="w-16 shrink-0 font-mono text-fg">{moveLabel(fen, move.san)}</span>
                <span className="flex h-1.5 w-20 shrink-0 overflow-hidden rounded-full bg-control">
                  <span className="bg-info" style={{ width: percent(move.probability) }} />
                </span>
                <span className="w-9 text-right tabular-nums text-fg-secondary">
                  {percent(move.probability)}
                </span>
                <span className="ml-auto flex items-center gap-1">
                  {move.inRepertoire ? <Badge tone="accent">In repertoire</Badge> : null}
                  {shouldPrepare(move, data.opponentToMove) ? (
                    <Badge tone="warn">Prepare</Badge>
                  ) : null}
                  {move.inRepertoire ? null : (
                    <AddButton label={`Add ${move.san}`} onClick={() => onStage([move.uci])} />
                  )}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}
    </Section>
  );
}

/** §6.3: the flags here (or in the whole repertoire), and the queue. */
function Health({ repertoireId, fen, onStage, onOpenFlag }: StudyExplorerProps) {
  const [whole, setWhole] = useState(false);
  const flags = useRepertoireHealthFlags(repertoireId);
  const status = useRepertoireHealthStatus();
  const queue = useRepertoireHealthQueueMutation();
  const key = useMemo(() => positionKey(fen), [fen]);
  const shown = whole ? flags : flags.filter((flag) => flag.positionKey === key);
  const actions = (
    <>
      <label className="flex items-center gap-1.5 text-2xs text-fg-muted">
        Whole repertoire
        <Switch checked={whole} onCheckedChange={setWhole} aria-label="Whole repertoire" />
      </label>
      <HealthQueueActions status={status.data} repertoireIds={[repertoireId]} queue={queue} />
    </>
  );
  return (
    <Section id="health" title="Health" actions={actions}>
      <HealthQueueLine status={status.data} queue={queue} />
      {shown.length ? (
        <ul className="grid gap-1" aria-label="Health flags">
          {shown.map((flag) => {
            const here = flag.positionKey === key;
            const fix = here ? flagFix(flag) : null;
            return (
              <li
                key={`${flag.kind} ${flag.positionKey} ${flag.uci}`}
                className="grid gap-0.5 border-t border-line-subtle py-1.5 text-xs first:border-t-0"
              >
                <span className="flex min-w-0 items-center gap-2">
                  <Badge tone="warn">
                    <AlertTriangle aria-hidden />
                    {HEALTH_FLAG_LABELS[flag.kind]}
                  </Badge>
                  <span
                    className="min-w-0 flex-1 truncate font-mono text-2xs text-fg-subtle"
                    title={flag.line}
                  >
                    {flag.line || "Starting position"}
                  </span>
                  {onOpenFlag && !here ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => onOpenFlag(flag)}
                    >
                      Open
                    </Button>
                  ) : null}
                  {fix ? (
                    <AddButton label={`Add the fix for ${flag.san}`} onClick={() => onStage(fix)} />
                  ) : null}
                </span>
                <span className="text-fg-secondary">{healthFlagText(flag)}</span>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="text-xs text-fg-muted">
          {whole ? "No flags in this repertoire." : "No flags at this position."}
        </p>
      )}
    </Section>
  );
}
