import { Fragment, useMemo, type ReactNode } from "react";
import { KeyRound, Loader2, MessageSquareOff, RefreshCw, Settings, Sparkles } from "lucide-react";
import type { PuzzleOutcomeKind } from "@chaturanga/shared/schemas/puzzle-insight";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { DEFAULT_COMMENTARY_MODEL } from "@chaturanga/shared/llm/models";
import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import {
  useEnginesQuery,
  useOpenRouterConfigQuery,
  useSettingsQuery,
  useUpdateSettingMutation
} from "../../queries/api";
import { useBoardSettingsStore } from "../../stores/board-settings-store";
import { useGameStore } from "../../stores/game-store";
import type { PuzzleWrongMove } from "../../stores/puzzle-store";
import { reviewEngineFor } from "../analysis/analysis-engine";
import { EngineAvatar } from "../analysis/EngineAvatar";
import { tokenizeCommentary } from "../game-review/commentary-moves";
import { MoveLink } from "../game-review/MoveLinks";
import { useOpenSettings } from "../settings/settings-link";
import { uciLineToSan } from "../game-review/review-utils";
import { explanationKey } from "./puzzle-explanation";
import {
  explainView,
  requestPuzzleExplanation,
  usePuzzleExplanationStore,
  type ExplainView
} from "./puzzle-explanation-store";
import { solutionIndexForToken, type PuzzleProseLine } from "./puzzle-prose";

const sparklesIcon = <Sparkles />;
const runningIcon = <Loader2 className="animate-spin" />;

/**
 * The puzzle card's actions once it is solved or failed (`actions`: Next puzzle, Play engine from
 * here), with "Explain with AI" as the last icon button of the row; under the row, the coach's
 * explanation (headline and body), its progress, or why it can't be asked. Its engine and
 * commentary settings (shared with Game review) are in the Moves tab's settings dialog.
 */
export function PuzzleExplanation({
  puzzle,
  kind,
  wrong,
  linkMoves,
  actions
}: {
  puzzle: PuzzleSample;
  kind: PuzzleOutcomeKind;
  /** The first wrong move (the one explained), when the puzzle failed by one. */
  wrong: PuzzleWrongMove | null;
  /** The solution is on the board's line: its moves in the text jump there. */
  linkMoves: boolean;
  /** The row's other buttons, before Explain. */
  actions: ReactNode;
}) {
  const settingsQuery = useSettingsQuery();
  const settings: AppSettings = { ...defaultSettings, ...settingsQuery.data };
  const engines = useEnginesQuery();
  const openRouter = useOpenRouterConfigQuery();
  const update = useUpdateSettingMutation();
  const key = explanationKey(puzzle, kind, wrong);
  const entry = usePuzzleExplanationStore((state) => state.entries[key]);
  const view = explainView({
    entry,
    configReady: settingsQuery.isSuccess && engines.isSuccess && openRouter.isSuccess,
    commentaryEnabled: settings.reviewCommentaryEnabled,
    hasApiKey: Boolean(openRouter.data?.hasApiKey)
  });
  const model = openRouter.data?.model || DEFAULT_COMMENTARY_MODEL;
  const engine = reviewEngineFor(engines.data, settings.defaultEngineId);
  const otherSan = entry?.otherSan;
  const proseLine = useMemo<PuzzleProseLine | null>(
    () =>
      linkMoves
        ? {
            fen: puzzle.initialFen,
            solutionSan: uciLineToSan(puzzle.initialFen, puzzle.solutionMoves),
            otherSan: otherSan ?? []
          }
        : null,
    [linkMoves, puzzle, otherSan]
  );
  const explain = () =>
    void requestPuzzleExplanation({ key, puzzle, kind, wrong, engine, settings });
  const openSettings = () => useBoardSettingsStore.getState().open("explanation");
  const openAppSettings = useOpenSettings();
  const running = view.kind === "analysing" || view.kind === "writing";
  // Asked again once there is an explanation (or an error); never while one is being written.
  const askable =
    view.kind === "idle" ? !view.disabled : view.kind === "ready" || view.kind === "error";

  const viewContent = () => {
    switch (view.kind) {
      case "idle":
        return null;
      case "analysing":
      case "writing":
        return <ExplainProgress phase={view.kind} engine={engine} model={model} />;
      case "ready":
        return <ExplanationCard explanation={view.explanation} line={proseLine} />;
      case "error":
        return (
          <ExplainError
            message={view.message}
            needsSettings={view.needsSettings}
            onRetry={explain}
            onOpenSettings={openSettings}
          />
        );
      case "no-key":
      case "off":
        return (
          <ExplainUnavailable
            reason={view.kind}
            // The key lives in app Settings → AI (every AI feature shares it).
            onAddKey={openAppSettings ? () => openAppSettings("ai") : openSettings}
            onTurnOn={() => update.mutate({ key: "reviewCommentaryEnabled", value: true })}
          />
        );
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex items-center gap-2">
        {actions}
        <IconButton
          label={view.kind === "ready" ? "Explain again with AI" : "Explain with AI"}
          icon={running ? runningIcon : sparklesIcon}
          variant="outline"
          size="icon"
          className="shrink-0"
          disabled={!askable}
          onClick={explain}
        />
      </div>
      <div className="grid gap-2 empty:hidden" aria-label="AI explanation" role="group">
        {viewContent()}
      </div>
    </div>
  );
}

/**
 * The search running for the explanation ("Analysing…", with its engine), then the writing (its
 * model).
 */
function ExplainProgress({
  phase,
  engine,
  model
}: {
  phase: "analysing" | "writing";
  /** The engine analysing the puzzle (Review settings' evaluation engine). */
  engine: EngineConfig | null;
  model: string;
}) {
  return (
    <div
      role="status"
      className="flex min-w-0 animate-fade-in items-center gap-2.5 rounded-lg border border-line bg-surface-sunken px-3 py-2"
    >
      <Loader2 className="size-4 shrink-0 animate-spin text-accent" aria-hidden />
      <span key={phase} className="animate-fade-in text-sm text-fg-secondary">
        {phase === "analysing" ? "Analysing…" : "Writing…"}
      </span>
      {phase === "analysing" ? (
        engine ? (
          <span className="ml-auto flex min-w-0 items-center gap-1.5 text-2xs text-fg-subtle">
            <EngineAvatar engine={engine} size="xs" />
            <span className="truncate">{engineDisplayName(engine.name)}</span>
          </span>
        ) : null
      ) : (
        <span
          className="ml-auto min-w-0 truncate text-2xs text-fg-subtle"
          title={`${model} via OpenRouter`}
        >
          {shortModelName(model)}
        </span>
      )}
    </div>
  );
}

/** The coach's explanation: its model, then the headline and text. */
function ExplanationCard({
  explanation,
  line
}: {
  explanation: Extract<ExplainView, { kind: "ready" }>["explanation"];
  line: PuzzleProseLine | null;
}) {
  return (
    <article className="grid animate-rise-in gap-1.5 rounded-lg border border-line bg-surface-sunken px-3 py-2.5">
      <div className="flex min-w-0 items-center gap-1.5">
        <Sparkles className="size-3.5 shrink-0 text-accent" aria-hidden />
        <span
          className="min-w-0 flex-1 truncate text-2xs text-fg-subtle"
          title={`Written by ${explanation.providerModel}`}
        >
          {shortModelName(explanation.providerModel)}
        </span>
      </div>
      {explanation.headline ? (
        <h3 className="font-serif text-base font-semibold leading-6 text-fg">
          <PuzzleProse text={explanation.headline} line={line} />
        </h3>
      ) : null}
      <p className="font-serif text-sm leading-6 text-fg-secondary">
        <PuzzleProse text={explanation.prose} line={line} />
      </p>
    </article>
  );
}

/** Why the puzzle couldn't be explained: Settings when they are the fix, else Retry. */
function ExplainError({
  message,
  needsSettings,
  onRetry,
  onOpenSettings
}: {
  message: string;
  needsSettings: boolean;
  onRetry: () => void;
  onOpenSettings: () => void;
}) {
  return (
    <Notice
      tone="warn"
      title="Couldn't explain this puzzle."
      action={
        needsSettings ? (
          <Button type="button" variant="outline" size="xs" onClick={onOpenSettings}>
            <Settings />
            Settings
          </Button>
        ) : (
          <Button type="button" variant="outline" size="xs" onClick={onRetry}>
            <RefreshCw />
            Retry
          </Button>
        )
      }
    >
      {message}
    </Notice>
  );
}

/** Nothing can be asked yet: no OpenRouter key (Add API key), or AI commentary is off (Turn on). */
function ExplainUnavailable({
  reason,
  onAddKey,
  onTurnOn
}: {
  reason: "no-key" | "off";
  onAddKey: () => void;
  onTurnOn: () => void;
}) {
  const noKey = reason === "no-key";
  return (
    <div className="flex items-center gap-2.5 rounded-lg border border-line bg-surface-sunken px-3 py-2">
      {noKey ? (
        <KeyRound className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      ) : (
        <MessageSquareOff className="size-4 shrink-0 text-fg-subtle" aria-hidden />
      )}
      <p className="min-w-0 flex-1 text-xs leading-5 text-fg-muted">
        {noKey ? "Explain with AI needs your OpenRouter API key." : "AI commentary is off."}
      </p>
      {noKey ? (
        <Button type="button" variant="outline" size="xs" onClick={onAddKey}>
          Add API key
        </Button>
      ) : (
        <Button type="button" variant="outline" size="xs" onClick={onTurnOn}>
          Turn on
        </Button>
      )}
    </div>
  );
}

/**
 * The explanation's text; once the solution is on the board's line, the moves that name one of its
 * plies are links that jump there (like the Solution list). Other moves stay text: playing them
 * would leave the puzzle.
 */
function PuzzleProse({ text, line }: { text: string; line: PuzzleProseLine | null }) {
  const segments = useMemo(() => tokenizeCommentary(text), [text]);
  return (
    <>
      {segments.map((segment, position) => {
        // Squares stay text: the puzzle board has no previews.
        if (segment.kind !== "move") return <Fragment key={position}>{segment.text}</Fragment>;
        const index = line ? solutionIndexForToken(segment, line) : null;
        if (!line || index === null) return <Fragment key={position}>{segment.text}</Fragment>;
        const moves = line.solutionSan.slice(0, index + 1);
        return (
          <MoveLink
            key={position}
            san={line.solutionSan[index]}
            onActivate={() => useGameStore.getState().goToLine("root", [...moves])}
          >
            {segment.text}
          </MoveLink>
        );
      })}
    </>
  );
}

/** "anthropic/claude-haiku-5.5" → "claude-haiku-5.5"; the full id is in the tooltip. */
function shortModelName(model: string): string {
  return model.split("/").pop() || model;
}
