import { lazy, Suspense, useState } from "react";
import { BookOpen, CircleHelp, GraduationCap, Plus, RotateCcw, Settings, Zap } from "lucide-react";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type { MasteryCounts, PracticeOverview } from "@chaturanga/shared/types/repertoire-practice";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { Skeleton } from "@/components/ui/skeleton";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { cn } from "@/lib/utils";
import { usePracticeOverviewQuery } from "../../../queries/repertoire-practice";
import { body, footer, titleBar } from "../../database/DatabaseCard";
import { CardTitleBar } from "../../play/card-title";
import { BoardThumbnail } from "../../settings/board-thumbnail";
import { learnedText } from "../hub-groups";
import { HubTabActions } from "../hub-tab-actions";
import { WeakSpotsBanner } from "../insights/WeakSpotsBanner";
import type { WeakSpotsTarget } from "../insights/insights-actions";
import type { PracticePreset } from "../practice-setup";
import { COLOR_LABELS } from "../repertoire-chapters";
import {
  colorMastery,
  practiceSets,
  setActions,
  setPreset,
  type PracticeSetCard
} from "./practice-sets";

const PROGRESS_ID = "practice-progress-title";

const PracticeSettingsDialog = lazy(() =>
  import("./PracticeSettingsDialog").then((module) => ({
    default: module.PracticeSettingsDialog
  }))
);
const HowItWorksDialog = lazy(() =>
  import("./HowItWorksDialog").then((module) => ({ default: module.HowItWorksDialog }))
);

/** A set's tile: sunken, inside the hub card (no card within the card). */
const tile = "flex min-w-0 flex-col rounded-lg bg-surface-sunken leading-[1.43]";

/**
 * Repertoire → Practice (docs/repertoire-games-and-practice.md §4): the weak spots from your games,
 * a tile per set (Everything, each colour, each repertoire) with Review / Practice early and Learn
 * new, then Progress: a mastery bar per colour and each repertoire's perfect lines. How it works and
 * Practice settings (the cog, last) sit at the end of the hub card's tab bar.
 */
export function PracticeTab({
  onPracticePreset,
  onPractiseWeakSpots,
  onSeeReport
}: {
  onPracticePreset: (repertoireId: string, preset: PracticePreset) => void;
  onPractiseWeakSpots: (target: WeakSpotsTarget, repertoireIds: string[]) => void;
  onSeeReport: () => void;
}) {
  return (
    <>
      <PracticeTools />
      <PracticeContent
        onPracticePreset={onPracticePreset}
        onPractiseWeakSpots={onPractiseWeakSpots}
        onSeeReport={onSeeReport}
      />
    </>
  );
}

/** How it works, then Practice settings (the cog, last), with their dialogs. */
function PracticeTools() {
  const [dialog, setDialog] = useState<"settings" | "help" | null>(null);
  const close = () => setDialog(null);
  return (
    <>
      <HubTabActions>
        <IconButton label="How it works" icon={<CircleHelp />} onClick={() => setDialog("help")} />
        <IconButton
          label="Practice settings"
          icon={<Settings />}
          onClick={() => setDialog("settings")}
        />
      </HubTabActions>
      <Suspense fallback={null}>
        {dialog === "settings" ? <PracticeSettingsDialog onClose={close} /> : null}
        {dialog === "help" ? <HowItWorksDialog onClose={close} /> : null}
      </Suspense>
    </>
  );
}

function PracticeContent({
  onPracticePreset,
  onPractiseWeakSpots,
  onSeeReport
}: Parameters<typeof PracticeTab>[0]) {
  const overview = usePracticeOverviewQuery();
  // "Next review in 3 days" is relative to when the tab opened (render stays pure).
  const [now] = useState(() => Date.now());
  if (overview.isPending) return <CardsLoading />;
  if (overview.isError) {
    return (
      <div className="p-4">
        <Notice
          tone="danger"
          title="Couldn't load your practice"
          action={
            <Button
              type="button"
              variant="outline"
              size="xs"
              onClick={() => void overview.refetch()}
            >
              <RotateCcw />
              Try again
            </Button>
          }
        >
          {ipcErrorMessage(overview.error)}
        </Notice>
      </div>
    );
  }
  const sets = practiceSets(overview.data);
  if (!sets.length) {
    return (
      <EmptyState
        className="m-auto py-16"
        icon={<GraduationCap />}
        title="Nothing to practise yet"
        description="Create a repertoire or import a PGN on the Repertoires tab; its moves are practised here."
      />
    );
  }
  const ids = overview.data.repertoires.map((item) => item.repertoireId);
  const start = (set: PracticeSetCard, action: "review" | "early" | "learn") =>
    onPracticePreset(set.repertoireIds[0], setPreset(set, action));
  return (
    <>
      <div className="grid gap-4 p-4">
        <WeakSpotsBanner
          onPractise={() => onPractiseWeakSpots(null, ids)}
          onSeeReport={onSeeReport}
        />
        <ul
          aria-label="Practice sets"
          className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4"
        >
          {sets.map((set) => (
            <SetCard
              key={set.key}
              set={set}
              overview={overview.data}
              now={now}
              onStart={(action) => start(set, action)}
            />
          ))}
        </ul>
      </div>
      <PracticeProgress overview={overview.data} />
    </>
  );
}

function CardsLoading() {
  return (
    <div
      aria-busy="true"
      aria-label="Loading practice"
      className="grid grid-cols-[repeat(auto-fill,minmax(19rem,1fr))] gap-4 p-4"
    >
      {[0, 1, 2].map((index) => (
        <div key={index} className={cn(tile, "h-56 p-4")}>
          <Skeleton className="h-3 w-32" />
        </div>
      ))}
    </div>
  );
}

/** A set: its counts and its actions (Review or Practice early, and Learn new). */
function SetCard({
  set,
  overview,
  now,
  onStart
}: {
  set: PracticeSetCard;
  overview: PracticeOverview;
  now: number;
  onStart: (action: "review" | "early" | "learn") => void;
}) {
  const actions = setActions(set, overview, now);
  return (
    <li className={tile} aria-label={set.title}>
      <div className={titleBar}>
        <h2 className="truncate text-sm font-medium text-fg">{set.title}</h2>
      </div>
      <div className={body}>
        <BoardThumbnail
          fen={set.thumbnail.fen ?? START_FEN}
          orientation={set.thumbnail.color}
          className="w-24 shrink-0 self-start"
        />
        <div className="grid min-w-0 content-start gap-1 text-xs">
          <p className="text-fg-muted">{set.subtitle}</p>
          <p className="text-fg-secondary tabular-nums">
            <span className={set.due ? "font-semibold text-accent" : undefined}>{set.due} due</span>
            {" · "}
            {set.new} new · {set.learning} learning
          </p>
          {actions.nothingDue ? <p className="text-fg-subtle">{actions.nothingDue}</p> : null}
        </div>
      </div>
      <div className={cn(footer, "flex flex-wrap items-center gap-2")}>
        {actions.main?.kind === "review" ? (
          <Button type="button" variant="primary" size="sm" onClick={() => onStart("review")}>
            <GraduationCap />
            Review {actions.main.count}
          </Button>
        ) : actions.main?.kind === "early" ? (
          <Button type="button" variant="outline" size="sm" onClick={() => onStart("early")}>
            <Zap />
            Practice early {actions.main.count}
          </Button>
        ) : null}
        {actions.learnNew ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={actions.learnNew.disabledReason !== null}
            title={actions.learnNew.disabledReason ?? undefined}
            onClick={() => onStart("learn")}
          >
            <Plus />
            Learn new{actions.learnNew.count ? ` ${actions.learnNew.count}` : ""}
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** Progress: a mastery bar per colour, then each repertoire's perfect lines. Nothing else. */
function PracticeProgress({ overview }: { overview: PracticeOverview }) {
  const colors = (["white", "black"] as const)
    .map((color) => ({ color, mastery: colorMastery(overview, color) }))
    .filter((item) => item.mastery !== null);
  return (
    <section aria-labelledby={PROGRESS_ID} className="border-t border-line-subtle">
      <CardTitleBar id={PROGRESS_ID} title="Progress" />
      <div className="grid gap-3 p-4">
        <dl className="grid gap-2">
          {colors.map(({ color, mastery }) => (
            <MasteryRow key={color} color={color} mastery={mastery!} />
          ))}
        </dl>
        <div className="grid gap-1">
          <p className="flex items-center gap-1.5 text-xs font-medium text-fg-muted">
            <BookOpen className="size-3.5" />
            Perfect lines
          </p>
          <ul aria-label="Perfect lines" className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {overview.repertoires.map((item) => (
              <li key={item.repertoireId} className="text-fg-secondary">
                {item.name}{" "}
                <span className="text-fg tabular-nums">
                  {item.perfectLines} of {item.lines}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}

/** One colour: a three-part bar (mastered · learning · new) with its counts and learned. */
function MasteryRow({
  color,
  mastery
}: {
  color: RepertoireColor;
  mastery: MasteryCounts & { learned: number; total: number };
}) {
  const total = Math.max(1, mastery.mastered + mastery.learning + mastery.new);
  const share = (count: number) => `${(count / total) * 100}%`;
  const counts = `${mastery.mastered} mastered · ${mastery.learning} learning · ${mastery.new} new`;
  return (
    <div className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-3 text-xs">
      <dt className="font-medium text-fg-secondary">{COLOR_LABELS[color]}</dt>
      <dd className="grid gap-1">
        <span
          role="img"
          aria-label={`${COLOR_LABELS[color]}: ${counts}`}
          className="flex h-1.5 overflow-hidden rounded-full bg-control"
        >
          <span className="bg-accent" style={{ width: share(mastery.mastered) }} />
          <span className="bg-accent/45" style={{ width: share(mastery.learning) }} />
        </span>
        <span className="text-fg-muted tabular-nums">{counts}</span>
      </dd>
      <dd className="text-fg-secondary tabular-nums">
        {learnedText(mastery.learned, mastery.total)}
      </dd>
    </div>
  );
}
