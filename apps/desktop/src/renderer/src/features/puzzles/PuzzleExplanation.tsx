import { Fragment, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Loader2, MessageSquareOff, RefreshCw, Settings, Sparkles } from "lucide-react";
import type { PuzzleOutcomeKind } from "@chaturanga/shared/schemas/puzzle-insight";
import type { PuzzleSample } from "@chaturanga/shared/types/database";
import { defaultSettings, type AppSettings } from "@chaturanga/shared/types/settings";
import { DEFAULT_COMMENTARY_MODEL } from "@chaturanga/shared/llm/models";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import {
  useEnginesQuery,
  useOpenRouterConfigQuery,
  useSettingsQuery,
  useUpdateSettingMutation
} from "../../queries/api";
import { useGameStore } from "../../stores/game-store";
import type { PuzzleWrongMove } from "../../stores/puzzle-store";
import { tokenizeCommentary } from "../game-review/commentary-moves";
import { MoveLink } from "../game-review/MoveLinks";
import { ReviewSettingsPanel } from "../game-review/ReviewSettingsPanel";
import { useOpenSettings } from "../settings/settings-link";
import { uciLineToSan } from "../game-review/review-utils";
import { explainEngine, explanationKey } from "./puzzle-explanation";
import {
  explainView,
  requestPuzzleExplanation,
  usePuzzleExplanationStore,
  type ExplainView
} from "./puzzle-explanation-store";
import { solutionIndexForToken, type PuzzleProseLine } from "./puzzle-prose";

const settingsIcon = <Settings />;

/**
 * "Explain with AI" in the puzzle card, once the puzzle is solved or failed: one button, then the
 * coach's explanation (headline and body) with Regenerate, and a gear for the engine and
 * commentary settings it shares with Game review.
 */
export function PuzzleExplanation({
  puzzle,
  kind,
  wrong,
  linkMoves
}: {
  puzzle: PuzzleSample;
  kind: PuzzleOutcomeKind;
  /** The first wrong move (the one explained), when the puzzle failed by one. */
  wrong: PuzzleWrongMove | null;
  /** The solution is on the board's line: its moves in the text jump there. */
  linkMoves: boolean;
}) {
  const settingsQuery = useSettingsQuery();
  const settings: AppSettings = { ...defaultSettings, ...settingsQuery.data };
  const engines = useEnginesQuery();
  const openRouter = useOpenRouterConfigQuery();
  const update = useUpdateSettingMutation();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const key = explanationKey(puzzle, kind, wrong);
  const entry = usePuzzleExplanationStore((state) => state.entries[key]);
  const view = explainView({
    entry,
    configReady: settingsQuery.isSuccess && engines.isSuccess && openRouter.isSuccess,
    commentaryEnabled: settings.reviewCommentaryEnabled,
    hasApiKey: Boolean(openRouter.data?.hasApiKey)
  });
  const model = openRouter.data?.model || DEFAULT_COMMENTARY_MODEL;
  const engine = explainEngine(engines.data ?? [], settings.defaultEngineId);
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
  const openSettings = () => setSettingsOpen(true);
  const openAppSettings = useOpenSettings();
  const gear = (
    <IconButton
      label="Explanation settings"
      icon={settingsIcon}
      size="icon-sm"
      onClick={openSettings}
    />
  );

  const viewContent = () => {
    switch (view.kind) {
      case "idle":
        return (
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              disabled={view.disabled}
              onClick={explain}
            >
              <Sparkles />
              Explain with AI
            </Button>
            {gear}
          </div>
        );
      case "analysing":
      case "writing":
        return <ExplainProgress phase={view.kind} engineName={engine?.name} model={model} />;
      case "ready":
        return (
          <ExplanationCard
            explanation={view.explanation}
            line={proseLine}
            onRegenerate={explain}
            onOpenSettings={openSettings}
          />
        );
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
            onOpenSettings={openSettings}
          />
        );
    }
  };

  return (
    <div className="grid gap-2" aria-label="AI explanation" role="group">
      {viewContent()}
      {settingsOpen
        ? createPortal(
            <Dialog
              title="Explanation settings"
              description="Shared with Game review: the engine that analyses the puzzle and the AI that explains it."
              onClose={() => setSettingsOpen(false)}
              footer={
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setSettingsOpen(false)}
                >
                  Done
                </Button>
              }
            >
              <ReviewSettingsPanel settings={settings} />
            </Dialog>,
            document.body
          )
        : null}
    </div>
  );
}

/**
 * The search running for the explanation ("Analysing…", with its engine), then the writing (its
 * model).
 */
function ExplainProgress({
  phase,
  engineName,
  model
}: {
  phase: "analysing" | "writing";
  engineName: string | undefined;
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
      <span
        className="ml-auto min-w-0 truncate text-2xs text-fg-subtle"
        title={phase === "writing" ? `${model} via OpenRouter` : undefined}
      >
        {phase === "analysing" ? engineName : shortModelName(model)}
      </span>
    </div>
  );
}

/** The coach's explanation: its model, Regenerate and the settings, then the headline and text. */
function ExplanationCard({
  explanation,
  line,
  onRegenerate,
  onOpenSettings
}: {
  explanation: Extract<ExplainView, { kind: "ready" }>["explanation"];
  line: PuzzleProseLine | null;
  onRegenerate: () => void;
  onOpenSettings: () => void;
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
        <IconButton label="Regenerate" icon={<RefreshCw />} size="icon-xs" onClick={onRegenerate} />
        <IconButton
          label="Explanation settings"
          icon={settingsIcon}
          size="icon-xs"
          onClick={onOpenSettings}
        />
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
          <div className="flex items-center gap-1">
            <Button type="button" variant="outline" size="xs" onClick={onRetry}>
              <RefreshCw />
              Retry
            </Button>
            <IconButton
              label="Explanation settings"
              icon={settingsIcon}
              size="icon-xs"
              onClick={onOpenSettings}
            />
          </div>
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
  onTurnOn,
  onOpenSettings
}: {
  reason: "no-key" | "off";
  onAddKey: () => void;
  onTurnOn: () => void;
  onOpenSettings: () => void;
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
        <>
          <Button type="button" variant="outline" size="xs" onClick={onTurnOn}>
            Turn on
          </Button>
          <IconButton
            label="Explanation settings"
            icon={settingsIcon}
            size="icon-xs"
            onClick={onOpenSettings}
          />
        </>
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
        if (segment.kind === "text") return <Fragment key={position}>{segment.text}</Fragment>;
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

/** "anthropic/claude-sonnet-4.6" → "claude-sonnet-4.6"; the full id is in the tooltip. */
function shortModelName(model: string): string {
  return model.split("/").pop() || model;
}
