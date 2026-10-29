import { forwardRef, useId, type ReactNode } from "react";
import { ChevronLeft, ChevronRight, Play } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { RATING_MODE_LABELS } from "@chaturanga/shared/types/ratings";
import {
  INSIGHTS_GAMES_PAGE_SIZE,
  type InsightsGameRow,
  type InsightsGamesQuery
} from "@chaturanga/shared/types/repertoire-insights";
import { useInsightsGamesQuery } from "../../../queries/repertoire-insights";
import { CardTitleBar } from "../../play/card-title";
import type { InsightsReviewTarget } from "./insights-actions";
import { OUTCOME_FILTERS, outcomeFilterIndex, outcomePill } from "./insights-format";

const TITLE_ID = "insights-games-title";

const ACCOUNT_LABELS: Record<InsightsGameRow["account"], string> = {
  lichess: "Lichess",
  chesscom: "Chess.com",
  imported: "Imported"
};

const RESULT_PILL: Record<
  NonNullable<InsightsGameRow["result"]>,
  { label: string; tone: "accent" | "danger" | "neutral" }
> = {
  win: { label: "Won", tone: "accent" },
  draw: { label: "Draw", tone: "neutral" },
  loss: { label: "Lost", tone: "danger" }
};

const columns =
  "grid grid-cols-[5.5rem_5rem_1rem_minmax(0,1.2fr)_3.5rem_5.5rem_minmax(0,1.2fr)_minmax(0,1fr)_4.5rem] items-center gap-x-3 px-4";

/**
 * Insights' Games section (§5.3): the compared games, newest first, 50 a page, under the saved filters
 * and its own (outcome, up to move, and a report row's position). A row opens Game review at the
 * move the outcome is about.
 */
export const InsightsGamesCard = forwardRef<
  HTMLElement,
  {
    query: InsightsGamesQuery;
    onQueryChange: (query: InsightsGamesQuery) => void;
    onReview: (target: InsightsReviewTarget) => void;
  }
>(function InsightsGamesCard({ query, onQueryChange, onReview }, ref) {
  const outcomeId = useId();
  const upToId = useId();
  const games = useInsightsGamesQuery(query);
  const page = games.data;
  const narrowed = Boolean(query.positionKey);
  const set = (patch: Partial<InsightsGamesQuery>) =>
    onQueryChange({ ...query, ...patch, page: 0 });

  let body: ReactNode;
  if (games.isPending) {
    body = (
      <div aria-busy="true" aria-label="Loading games" className="grid gap-2 p-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Skeleton key={index} className="h-8 w-full" />
        ))}
      </div>
    );
  } else if (games.isError) {
    body = (
      <Notice
        tone="danger"
        className="m-4 w-auto"
        action={
          <Button type="button" size="xs" variant="outline" onClick={() => void games.refetch()}>
            Try again
          </Button>
        }
      >
        {ipcErrorMessage(games.error) || "The games couldn't be read."}
      </Notice>
    );
  } else if (!page?.rows.length) {
    body = <p className="px-4 py-6 text-sm text-fg-muted">No games match these filters.</p>;
  } else {
    body = (
      <ul aria-label="Games">
        {page.rows.map((row) => (
          <GameRow key={row.gameId} row={row} onReview={onReview} />
        ))}
      </ul>
    );
  }

  const pages = page ? Math.ceil(page.total / INSIGHTS_GAMES_PAGE_SIZE) : 0;
  return (
    <section ref={ref} aria-labelledby={TITLE_ID} className="border-t border-line-subtle">
      <CardTitleBar
        id={TITLE_ID}
        title="Games"
        count={page?.total ?? null}
        actions={
          <>
            <label htmlFor={outcomeId} className="sr-only">
              Outcome
            </label>
            <Select
              id={outcomeId}
              className="h-8 w-auto text-xs"
              value={String(outcomeFilterIndex(query.outcomes ?? null))}
              onChange={(event) =>
                set({ outcomes: OUTCOME_FILTERS[Number(event.target.value)]?.outcomes ?? null })
              }
            >
              {OUTCOME_FILTERS.map((choice, index) => (
                <option key={choice.label} value={index}>
                  {choice.label}
                </option>
              ))}
            </Select>
            <label htmlFor={upToId} className="sr-only">
              Up to move
            </label>
            <Input
              id={upToId}
              type="number"
              min={1}
              max={100}
              placeholder="Up to move"
              className="h-8 w-28 text-xs"
              value={query.upToMove ?? ""}
              onChange={(event) => {
                const move = Number.parseInt(event.target.value, 10);
                set({ upToMove: Number.isInteger(move) && move > 0 && move <= 100 ? move : null });
              }}
            />
          </>
        }
      />
      {narrowed ? (
        <div className="flex items-center gap-2 px-4 pb-2 text-xs text-fg-muted">
          <span>Games at one position of the report.</span>
          <Button
            type="button"
            variant="link"
            size="xs"
            onClick={() => set({ positionKey: null, uci: null, repertoireId: null })}
          >
            Show all games
          </Button>
        </div>
      ) : null}
      <div
        aria-hidden="true"
        className={`${columns} h-9 border-y border-b-line border-t-line-subtle bg-surface-sunken text-xs font-medium text-fg-muted`}
      >
        <span>Date</span>
        <span>Account</span>
        <span />
        <span>Opponent</span>
        <span>Result</span>
        <span>Time control</span>
        <span>Opening</span>
        <span>Outcome</span>
        <span />
      </div>
      {body}
      {pages > 1 ? (
        <div className="flex items-center justify-end gap-2 border-t border-line-subtle px-4 py-2 text-xs text-fg-muted">
          <span className="tabular-nums">
            Page {query.page + 1} of {pages}
          </span>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={query.page === 0}
            onClick={() => onQueryChange({ ...query, page: query.page - 1 })}
          >
            <ChevronLeft />
            Newer
          </Button>
          <Button
            type="button"
            size="xs"
            variant="ghost"
            disabled={query.page + 1 >= pages}
            onClick={() => onQueryChange({ ...query, page: query.page + 1 })}
          >
            Older
            <ChevronRight />
          </Button>
        </div>
      ) : null}
    </section>
  );
});

function GameRow({
  row,
  onReview
}: {
  row: InsightsGameRow;
  onReview: (target: InsightsReviewTarget) => void;
}) {
  const pill = outcomePill(row);
  const review = () =>
    onReview({
      gameId: row.gameId,
      ply: row.issue?.ply ?? null,
      repertoireId: row.repertoireId,
      color: row.color
    });
  const result = row.result ? RESULT_PILL[row.result] : null;
  return (
    <li
      className={`${columns} relative min-h-11 border-t border-line-subtle py-1.5 text-xs transition-colors duration-micro first:border-t-0 hover:bg-control/50 focus-within:bg-control/50`}
    >
      <span className="tabular-nums text-fg-secondary">
        {row.playedAt === null
          ? "—"
          : new Date(row.playedAt).toLocaleDateString(undefined, {
              month: "short",
              day: "numeric",
              year: "numeric"
            })}
      </span>
      <span className="truncate text-fg-muted">{ACCOUNT_LABELS[row.account]}</span>
      {row.color ? <SideDot color={row.color} /> : <span />}
      {/* The row's own action: the button covers the whole row (Review sits above it). */}
      <button
        type="button"
        onClick={review}
        className="min-w-0 truncate text-left text-fg outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-accent/50"
      >
        {row.opponent ?? "—"}
        {row.opponentRating ? (
          <span className="tabular-nums text-fg-muted"> ({row.opponentRating})</span>
        ) : null}
      </button>
      <span>
        {result ? (
          <Badge tone={result.tone} size="sm">
            {result.label}
          </Badge>
        ) : (
          <span className="text-fg-subtle">—</span>
        )}
      </span>
      <span className="truncate text-fg-muted">{RATING_MODE_LABELS[row.timeControl]}</span>
      <span className="min-w-0 truncate text-fg-muted" title={row.opening ?? undefined}>
        {row.opening ?? "—"}
      </span>
      <span className="relative z-10 min-w-0">
        <Badge
          tone={pill.tone}
          size="sm"
          title={pill.title ?? undefined}
          className="max-w-full truncate"
        >
          {pill.label}
        </Badge>
      </span>
      <span className="relative z-10">
        <Button type="button" size="xs" variant="ghost" onClick={review}>
          <Play />
          Review
        </Button>
      </span>
    </li>
  );
}
