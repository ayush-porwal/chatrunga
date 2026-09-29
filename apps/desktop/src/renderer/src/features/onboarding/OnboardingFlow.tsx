import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  CircleAlert,
  Download,
  ExternalLink,
  Loader2,
  Minus,
  RefreshCw,
  Sparkles
} from "lucide-react";
import {
  boardThemeSquareColors,
  defaultSettings,
  type AppSettings,
  type BoardTheme
} from "@chaturanga/shared/types/settings";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { SideDot } from "@/components/ui/side-dot";
import { Skeleton } from "@/components/ui/skeleton";
import { useExitGhost } from "@/components/ui/use-presence";
import { formatSize, setupRowPercent, type SetupRow } from "@/lib/engine-assets";
import { isElectronMac } from "@/lib/environment";
import { fieldHint, fieldLabel, focusRing, motion } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { useOpenRouterConfigQuery, useSettingsQuery } from "../../queries/api";
import { BoardThumbnail } from "../settings/board-thumbnail";
import { OPENROUTER_KEYS_URL, useOpenRouterSave } from "../settings/use-openrouter-save";
import { useSetSetting } from "../settings/use-set-setting";
import {
  LEVEL_PRESETS,
  ONBOARDING_STEPS,
  clampRating,
  nearestLevelPreset,
  onboardingStepLabels,
  type OnboardingStep
} from "./onboarding-state";
import { operaGameMoment } from "./opera-game";
import { useEngineSetup, type EngineSetup } from "./useEngineSetup";

/**
 * The first-run welcome: a full-window, five-step setup that ends in the app.
 *
 *   Welcome → Engines → Your level → AI coach → All set
 *
 * Layout: one fixed design frame (`.onb-frame` in app.css, 960×592 at scale 1) zoomed to fit the
 * window, so the board, type and spacing grow together on big windows and every edge stays where
 * it is from step to step. Left column: a board following Morphy's Opera game (illustration only),
 * the game's caption, and a coach note on the move shown; the note card's bottom edge is the
 * frame's bottom edge. Right column: the stepper (its top is the board's top), the step's content
 * (scrolls inside when long) and the footer — Back on the left, the primary action in a
 * fixed-width slot on the right, a secondary action just left of it — at the same place on every
 * step. Everything is optional: "Skip setup" (or Escape) leaves at any point, and engine downloads
 * keep running in the background whatever the user does next.
 *
 * Keyboard: focus moves to each step's heading (announced by screen readers), Tab stays inside the
 * welcome, Escape skips. Reduced motion: step, board and note changes are instant.
 */
export function OnboardingFlow({
  onFinish,
  onGoHome
}: {
  /** Marks the welcome done (stored) and closes it. */
  onFinish: () => void;
  /** Shows Home (the last step's "Start using Chaturanga"). */
  onGoHome: () => void;
}) {
  const [step, setStep] = useState<OnboardingStep>("welcome");
  // +1 moving forward, -1 back: the step content slides in from that side.
  const [direction, setDirection] = useState<1 | -1>(1);
  const [ownEngine, setOwnEngine] = useState(false);
  const [footer, setFooter] = useState<HTMLDivElement | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const headingRef = useRef<HTMLHeadingElement | null>(null);
  const headingId = useId();
  const setup = useEngineSetup();
  const settingsQuery = useSettingsQuery();
  const settings: AppSettings = { ...defaultSettings, ...(settingsQuery.data ?? {}) };
  const setSetting = useSetSetting();

  useExitGhost(rootRef, motion.ms.standard);

  // Each step's heading takes focus, so screen readers announce the step and Tab starts from it.
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true });
  }, [step]);

  const go = (next: OnboardingStep) => {
    setDirection(ONBOARDING_STEPS.indexOf(next) < ONBOARDING_STEPS.indexOf(step) ? -1 : 1);
    setStep(next);
  };
  const finishWith = (action?: () => void) => {
    onFinish();
    action?.();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    // The app's own shortcuts (move stepping, focus mode) must not act under the welcome.
    event.stopPropagation();
    if (event.key === "Escape") {
      event.preventDefault();
      finishWith();
      return;
    }
    if (event.key === "Tab") trapTab(event, rootRef.current);
  };

  const heading = { headingRef, headingId, footer };

  return (
    <div
      ref={rootRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={headingId}
      data-state="open"
      onKeyDown={onKeyDown}
      className="onb-root fixed inset-0 z-50 grid animate-fade-in grid-rows-[var(--titlebar-height)_minmax(0,1fr)_var(--titlebar-height)] bg-canvas text-fg [--titlebar-height:calc(54px/var(--window-zoom,1))] data-[state=closed]:animate-fade-out"
    >
      {/* Titlebar row: drags the window (the traffic lights sit on the left on macOS). "Skip setup"
          lines up with the frame's right edge, not the window corner. */}
      <div className="flex justify-center [-webkit-app-region:drag]">
        <div className="onb-bar flex items-center justify-end">
          <Button
            variant="ghost"
            size="sm"
            className="-mr-2.5 [-webkit-app-region:no-drag]"
            onClick={() => finishWith()}
          >
            {step === "done" ? "Close" : "Skip setup"}
          </Button>
        </div>
      </div>

      {/* The frame, centred in the whole window (a titlebar-high row balances it underneath). The
          empty space around it drags the window too. */}
      <div className="grid min-h-0 place-items-center overflow-hidden [-webkit-app-region:drag]">
        <div className="onb-frame grid grid-cols-[424px_464px] gap-x-[72px] [-webkit-app-region:no-drag]">
          <Stage step={step} />

          <div className="grid min-h-0 min-w-0 grid-rows-[auto_minmax(0,1fr)_auto]">
            <Stepper step={step} onSelect={go} />
            <div
              key={step}
              className="onb-step-in scroll-area scroll-fade -mx-1 mt-10 min-h-0 overflow-y-auto px-1 pb-1"
              style={{ "--onb-dir": direction } as React.CSSProperties}
            >
              <div className="grid content-start gap-6">
                {step === "welcome" ? (
                  <WelcomeStep {...heading} onNext={() => go("engines")} />
                ) : step === "engines" ? (
                  <EnginesStep
                    {...heading}
                    setup={setup}
                    onBack={() => go("welcome")}
                    onNext={() => go("level")}
                    onOwnEngine={() => {
                      setOwnEngine(true);
                      go("level");
                    }}
                  />
                ) : step === "level" ? (
                  <LevelStep
                    {...heading}
                    settings={settings}
                    setSetting={setSetting}
                    onBack={() => go("engines")}
                    onNext={() => go("coach")}
                  />
                ) : step === "coach" ? (
                  <CoachStep {...heading} onBack={() => go("level")} onNext={() => go("done")} />
                ) : (
                  <DoneStep
                    {...heading}
                    setup={setup}
                    ownEngine={ownEngine}
                    settings={settings}
                    onBack={() => go("coach")}
                    onDone={() => finishWith(onGoHome)}
                  />
                )}
              </div>
            </div>
            {/* The footer row: every step renders its buttons into it (StepFooter), so it never
                moves between steps and never animates with the content. */}
            <div
              ref={setFooter}
              data-slot="onb-footer"
              className="mt-5 border-t border-line-subtle pt-5"
            />
          </div>
        </div>
      </div>
      <div aria-hidden className="[-webkit-app-region:drag]" />
    </div>
  );
}

/* ------------------------------------------------------------------ stage */

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
function Stage({ step }: { step: OnboardingStep }) {
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

/* ------------------------------------------------------------------ stepper */

/** Where the user is in the five steps; finished steps can be revisited. */
function Stepper({
  step,
  onSelect
}: {
  step: OnboardingStep;
  onSelect: (step: OnboardingStep) => void;
}) {
  const current = ONBOARDING_STEPS.indexOf(step);
  return (
    <nav aria-label="Setup steps" data-slot="onb-stepper">
      <ol className="grid grid-cols-5 gap-2">
        {ONBOARDING_STEPS.map((item, index) => {
          const done = index < current;
          const active = index === current;
          return (
            <li key={item} className="min-w-0">
              <button
                type="button"
                disabled={!done}
                aria-current={active ? "step" : undefined}
                onClick={() => onSelect(item)}
                className={cn(
                  "group grid w-full min-w-0 gap-2 rounded-sm pb-0.5 text-left disabled:cursor-default",
                  focusRing
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "h-0.5 w-full rounded-full transition-colors duration-standard ease-standard",
                    done
                      ? "bg-accent/70 group-hover:bg-accent"
                      : active
                        ? "bg-fg"
                        : "bg-line-strong"
                  )}
                />
                <span
                  className={cn(
                    "truncate text-xs transition-colors duration-standard",
                    active
                      ? "text-fg"
                      : done
                        ? "text-fg-muted group-hover:text-fg-secondary"
                        : "text-fg-subtle"
                  )}
                >
                  {onboardingStepLabels[item]}
                  {done ? <span className="sr-only"> (done)</span> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ------------------------------------------------------------------ step chrome */

type StepHeadingProps = {
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  headingId: string;
  /** The frame's footer row, where StepFooter renders the step's buttons. */
  footer: HTMLDivElement | null;
};

function StepHeader({
  headingRef,
  headingId,
  title,
  children
}: Omit<StepHeadingProps, "footer"> & { title: string; children?: ReactNode }) {
  return (
    <header className="grid gap-3">
      <h1
        ref={headingRef}
        id={headingId}
        tabIndex={-1}
        data-slot="onb-heading"
        className="text-[1.875rem] font-semibold leading-9 tracking-tight text-fg outline-none"
      >
        {title}
      </h1>
      {children ? (
        <div className="grid gap-2 text-sm leading-6 text-fg-muted">{children}</div>
      ) : null}
    </header>
  );
}

/**
 * The step's buttons, rendered into the frame's footer row. The geometry never changes: Back on
 * the left (its slot kept on the first step), the primary action in a fixed-width slot on the
 * right, an optional secondary action just left of it.
 */
function StepFooter({
  footer,
  back,
  secondary,
  primary
}: {
  footer: HTMLDivElement | null;
  back?: () => void;
  secondary?: ReactNode;
  primary: ReactNode;
}) {
  if (!footer) return null;
  return createPortal(
    <div className="grid h-10 grid-cols-[6rem_minmax(0,1fr)_12.5rem] items-center gap-2">
      {back ? (
        // Pulled left by its padding so the label lines up with the heading's left edge.
        <Button variant="ghost" data-slot="onb-back" className="-ml-3 h-10 w-24 justify-start" onClick={back}>
          <ArrowLeft />
          Back
        </Button>
      ) : (
        <span aria-hidden className="h-10 w-24" />
      )}
      <div className="flex min-w-0 justify-end">{secondary}</div>
      {primary}
    </div>,
    footer
  );
}

/** The footer's primary button: fills the fixed slot, so its box is the same on every step. */
function PrimaryButton({
  className,
  ...props
}: React.ComponentProps<typeof Button>) {
  return (
    <Button
      variant="primary"
      data-slot="onb-primary"
      className={cn("h-10 w-full px-4", className)}
      {...props}
    />
  );
}

/* ------------------------------------------------------------------ steps */

function WelcomeStep({ onNext, footer, ...heading }: StepHeadingProps & { onNext: () => void }) {
  return (
    <>
      <StepHeader {...heading} title="Welcome to Chaturanga">
        <p className="text-base leading-7 text-fg-secondary">
          Review your chess games move by move. An engine finds the moments that mattered, and a
          coach explains them in plain words.
        </p>
        <p>
          Your games and engines stay on this computer. Setup takes about a minute, and you can skip
          any part of it.
        </p>
      </StepHeader>
      <StepFooter footer={footer} primary={<PrimaryButton onClick={onNext}>Continue</PrimaryButton>} />
    </>
  );
}

const rowPurpose: Record<SetupRow["key"], string> = {
  stockfish: "Scores every move and finds the best ones",
  maia: "Predicts what players at each rating would play",
  lc0: "A second opinion from a neural network"
};

function EnginesStep({
  setup,
  onBack,
  onNext,
  onOwnEngine,
  footer,
  ...heading
}: StepHeadingProps & {
  setup: EngineSetup;
  onBack: () => void;
  onNext: () => void;
  onOwnEngine: () => void;
}) {
  const size = formatSize(setup.offerBytes);
  // "Download" turns into "Continue": keyboard focus follows it instead of dropping to the page.
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const focusContinue = useRef(false);
  useEffect(() => {
    if (!setup.offer && focusContinue.current) {
      focusContinue.current = false;
      continueRef.current?.focus();
    }
  }, [setup.offer]);
  const nothingToShow = setup.statusLoaded && !setup.rows.length;
  // Nothing to download or list, but the user's own engine already runs Game review.
  const ownEngineOnly = nothingToShow && setup.status !== null && setup.engineReady;
  const allInstalled =
    ownEngineOnly ||
    (!setup.offer && setup.rows.length > 0 && setup.rows.every((row) => row.status === "ready"));
  return (
    <>
      <StepHeader
        {...heading}
        title={
          allInstalled && setup.phase !== "downloading"
            ? "Your engines are ready"
            : "Set up the engines"
        }
      >
        <p>
          {allInstalled
            ? "Everything Game review needs is installed. It can start straight away."
            : "Chess engines do the analysis. These two free ones cover everything Game review needs."}
        </p>
      </StepHeader>

      {!setup.statusLoaded ? (
        <ul
          className="grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle"
          aria-busy="true"
          aria-label="Checking engines"
        >
          {[0, 1].map((index) => (
            <li key={index} className="grid gap-1.5 bg-surface px-4 py-3.5">
              <Skeleton as="span" className="h-3 w-24 rounded" />
              <Skeleton as="span" className="h-2.5 w-56 rounded bg-control/70" />
            </li>
          ))}
        </ul>
      ) : ownEngineOnly ? (
        <Notice tone="info">
          Game review will use the engine you added. You can add more in Settings.
        </Notice>
      ) : nothingToShow ? (
        <Notice tone="info">
          {setup.status
            ? "No engine downloads are available for this computer. You can add your own engine in Settings."
            : "Engine downloads need the desktop app. You can add your own engine in Settings."}
        </Notice>
      ) : (
        <div className="grid gap-3">
          <ul
            className="grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle"
            aria-label="Engines"
          >
            {setup.rows.map((row) => (
              <EngineRow
                key={row.key}
                row={row}
                offer={setup.offer}
                onRetry={() => setup.retry(row)}
              />
            ))}
          </ul>
          {setup.phase === "downloading" ? (
            <p className={fieldHint} role="status">
              Downloads keep going in the background while you continue.
            </p>
          ) : setup.lc0.missing ? (
            <p className={fieldHint}>
              {setup.lc0.autoDownload
                ? "Lc0, an optional neural-network engine, can be added later in Settings, Engine downloads."
                : "Lc0, the neural-network engine Maia runs in, has no automatic download for this computer. Install it yourself later and add it in Settings to use Maia."}
            </p>
          ) : null}
        </div>
      )}

      <StepFooter
        footer={footer}
        back={onBack}
        secondary={
          setup.offer ? (
            <Button variant="ghost" className="h-10" onClick={onOwnEngine}>
              I’ll use my own engine
            </Button>
          ) : null
        }
        primary={
          setup.offer ? (
            <PrimaryButton
              onClick={() => {
                focusContinue.current = document.activeElement instanceof HTMLButtonElement;
                setup.start();
              }}
            >
              <Download />
              {size ? `Download (${size})` : "Download"}
            </PrimaryButton>
          ) : (
            <PrimaryButton ref={continueRef} onClick={onNext}>
              Continue
            </PrimaryButton>
          )
        }
      />
    </>
  );
}

function EngineRow({
  row,
  offer,
  onRetry
}: {
  row: SetupRow;
  offer: boolean;
  onRetry: () => void;
}) {
  const pct = setupRowPercent(row);
  const busy =
    row.status === "downloading" || row.status === "verifying" || row.status === "installing";
  return (
    <li className="grid gap-2 bg-surface px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span className="grid min-w-0 flex-1 gap-0.5">
          <span className="truncate text-sm font-medium text-fg-secondary">{row.label}</span>
          <span className="truncate text-xs text-fg-subtle">{rowPurpose[row.key]}</span>
        </span>
        <span
          className="flex shrink-0 items-center gap-1.5 text-xs tabular-nums"
          role={offer ? undefined : "status"}
        >
          {offer ? (
            <span className="text-fg-subtle">{formatSize(row.bytesTotal)}</span>
          ) : row.status === "ready" ? (
            <span className="flex items-center gap-1.5 text-accent">
              <CheckCircle2 className="size-4 animate-pop-in" aria-hidden />
              Ready
            </span>
          ) : row.status === "error" ? (
            <>
              <span className="flex items-center gap-1.5 text-danger">
                <CircleAlert className="size-4" aria-hidden />
                Failed
              </span>
              <Button
                variant="outline"
                size="xs"
                onClick={onRetry}
                aria-label={`Retry ${row.label}`}
              >
                <RefreshCw />
                Retry
              </Button>
            </>
          ) : busy ? (
            <span className="flex items-center gap-1.5 text-fg-muted">
              <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
              {row.status === "downloading"
                ? `${pct}%`
                : row.status === "verifying"
                  ? "Verifying"
                  : "Installing"}
            </span>
          ) : (
            <span className="text-fg-subtle">Queued</span>
          )}
        </span>
      </div>
      {!offer && row.status !== "ready" ? (
        <Progress
          value={
            row.status === "error"
              ? 100
              : row.status === "verifying" || row.status === "installing"
                ? null
                : pct
          }
          tone={row.status === "error" ? "danger" : "accent"}
          aria-label={`${row.label} download`}
        />
      ) : null}
    </li>
  );
}

const themeSwatches: { id: BoardTheme; label: string }[] = [
  { id: "brown", label: "Brown" },
  { id: "green", label: "Green" },
  { id: "blue", label: "Blue" },
  { id: "slate", label: "Slate" }
];

function LevelStep({
  settings,
  setSetting,
  onBack,
  onNext,
  footer,
  ...heading
}: StepHeadingProps & {
  settings: AppSettings;
  setSetting: ReturnType<typeof useSetSetting>;
  onBack: () => void;
  onNext: () => void;
}) {
  const [ratingText, setRatingText] = useState(String(settings.reviewPlayerRating));
  const selected = nearestLevelPreset(settings.reviewPlayerRating);
  const exact = LEVEL_PRESETS.some((preset) => preset.rating === settings.reviewPlayerRating);
  const customTheme = Boolean(settings.boardSquareLight || settings.boardSquareDark);

  const setRating = (rating: number) => {
    setRatingText(String(rating));
    setSetting("reviewPlayerRating", rating);
  };

  return (
    <>
      <StepHeader {...heading} title="Your level">
        <p>
          The coach pitches its explanations to your rating, and Maia shows what players around it
          would play.
        </p>
      </StepHeader>

      <fieldset className="grid gap-2">
        <legend className={cn(fieldLabel, "mb-2")}>Your rating</legend>
        <div role="radiogroup" aria-label="Your rating" className="grid grid-cols-5 gap-2">
          {LEVEL_PRESETS.map((preset) => {
            const checked = selected.rating === preset.rating;
            return (
              <button
                key={preset.rating}
                type="button"
                role="radio"
                aria-checked={checked}
                tabIndex={checked ? 0 : -1}
                onClick={() => setRating(preset.rating)}
                onKeyDown={(event) =>
                  radioKeys(
                    event,
                    LEVEL_PRESETS.map((item) => item.rating),
                    preset.rating,
                    setRating
                  )
                }
                className={cn(
                  "grid min-w-0 gap-0.5 rounded-lg border px-2.5 py-2 text-left",
                  motion.press,
                  focusRing,
                  checked
                    ? "border-accent/50 bg-accent-soft text-fg"
                    : "border-line bg-surface text-fg-secondary hover:border-line-strong hover:bg-control"
                )}
              >
                <span
                  className={cn(
                    "text-base font-semibold tabular-nums",
                    checked ? "text-accent-fg" : "text-fg"
                  )}
                >
                  {checked && !exact ? settings.reviewPlayerRating : preset.rating}
                </span>
                <span className="truncate text-2xs text-fg-muted">{preset.label}</span>
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-2 pt-1">
          <label htmlFor="onboarding-rating" className="text-xs text-fg-muted">
            Or type it
          </label>
          <Input
            id="onboarding-rating"
            type="number"
            inputMode="numeric"
            min={400}
            max={3500}
            step={10}
            className="h-8 w-24 tabular-nums"
            value={ratingText}
            onChange={(event) => {
              setRatingText(event.target.value);
              const value = Number(event.target.value);
              if (event.target.value && value >= 400 && value <= 3500)
                setSetting("reviewPlayerRating", Math.round(value));
            }}
            onBlur={() =>
              setRating(clampRating(Number(ratingText) || settings.reviewPlayerRating))
            }
          />
          <span className={fieldHint}>Any rating system is fine; a guess works too.</span>
        </div>
      </fieldset>

      <div className="grid grid-cols-2 gap-6">
        <div className="grid content-start gap-2">
          <span className={fieldLabel}>Side you usually review</span>
          <div className="flex h-10 items-center">
          <SegmentedControl
            ariaLabel="Side you usually review"
            className="w-full"
            fullWidth
            value={settings.reviewPlayerColor}
            onChange={(value) => setSetting("reviewPlayerColor", value)}
            options={[
              { value: "white", label: "White", icon: <SideDot color="white" /> },
              { value: "black", label: "Black", icon: <SideDot color="black" /> }
            ]}
          />
          </div>
          <p className={fieldHint}>Explanations are written for this side.</p>
        </div>

        <div className="grid content-start gap-2">
          <span className={fieldLabel}>Board</span>
          <div role="radiogroup" aria-label="Board colours" className="flex h-10 items-center gap-2">
            {themeSwatches.map((theme) => {
              const checked = !customTheme && settings.boardTheme === theme.id;
              const colors = boardThemeSquareColors[theme.id];
              return (
                <button
                  key={theme.id}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  aria-label={theme.label}
                  title={theme.label}
                  tabIndex={
                    checked ||
                    (customTheme && theme.id === "brown") ||
                    (!themeSwatches.some((t) => t.id === settings.boardTheme) &&
                      theme.id === "brown")
                      ? 0
                      : -1
                  }
                  onClick={() => pickTheme(setSetting, theme.id)}
                  onKeyDown={(event) =>
                    radioKeys(
                      event,
                      themeSwatches.map((item) => item.id),
                      theme.id,
                      (id) => pickTheme(setSetting, id)
                    )
                  }
                  className={cn(
                    "relative size-9 overflow-hidden rounded-lg ring-offset-2 ring-offset-canvas",
                    motion.press,
                    // The selected swatch already wears the accent ring: keyboard focus is a light one.
                    "outline-none focus-visible:ring-2 focus-visible:ring-fg",
                    checked ? "ring-2 ring-accent" : "ring-1 ring-line hover:ring-line-strong"
                  )}
                  style={{
                    background: `conic-gradient(${colors.dark} 25%, ${colors.light} 0 50%, ${colors.dark} 0 75%, ${colors.light} 0) 0 0 / 50% 50%`
                  }}
                >
                  {checked ? (
                    <span className="absolute inset-0 grid place-items-center bg-black/25 text-white">
                      <Check className="size-4" strokeWidth={2.5} aria-hidden />
                    </span>
                  ) : null}
                </button>
              );
            })}
          </div>
          <p className={fieldHint}>More in Settings, Board.</p>
        </div>
      </div>

      <StepFooter
        footer={footer}
        back={onBack}
        primary={<PrimaryButton onClick={onNext}>Continue</PrimaryButton>}
      />
    </>
  );
}

/** A theme and its (reset) square colors are one write, never half-applied. */
function pickTheme(setSetting: ReturnType<typeof useSetSetting>, theme: BoardTheme) {
  setSetting.many({ boardTheme: theme, boardSquareLight: null, boardSquareDark: null });
}

/** Arrow keys move the selection inside a custom radiogroup (and focus follows it). */
function radioKeys<T>(
  event: KeyboardEvent<HTMLButtonElement>,
  values: readonly T[],
  current: T,
  select: (value: T) => void
) {
  const delta =
    event.key === "ArrowRight" || event.key === "ArrowDown"
      ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp"
        ? -1
        : 0;
  if (!delta) return;
  event.preventDefault();
  const index = (values.indexOf(current) + delta + values.length) % values.length;
  select(values[index]);
  const buttons =
    event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="radio"]');
  buttons?.[index]?.focus();
}

function CoachStep({
  onBack,
  onNext,
  footer,
  ...heading
}: StepHeadingProps & { onBack: () => void; onNext: () => void }) {
  const { hasApiKey, saveState, save, config } = useOpenRouterSave();
  const [key, setKey] = useState("");
  const [replacing, setReplacing] = useState(false);
  const showField = !hasApiKey || replacing;

  const saveAndContinue = async () => {
    if (!key.trim()) {
      onNext();
      return;
    }
    if (await save({ apiKey: key })) {
      setKey("");
      setReplacing(false);
      onNext();
    }
  };

  return (
    <>
      <StepHeader {...heading} title="Add the AI coach">
        <p>
          The coach writes the explanations in Game review. It uses an AI model through OpenRouter
          with your own key, so you choose the model and pay OpenRouter for what you use.
        </p>
      </StepHeader>

      <dl className="grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle text-sm">
        <div className="grid gap-0.5 bg-surface px-4 py-3">
          <dt className="font-medium text-fg-secondary">What is sent</dt>
          <dd className="leading-5 text-fg-muted">
            The position, the moves and the engine’s findings for the move you are reading. Nothing
            else from this computer.
          </dd>
        </div>
        <div className="grid gap-0.5 bg-surface px-4 py-3">
          <dt className="font-medium text-fg-secondary">Where your key is kept</dt>
          <dd className="leading-5 text-fg-muted">
            Encrypted on this computer, and only read to send a request.
            {isElectronMac() ? " Your Mac may ask once to allow keychain access." : null}
          </dd>
        </div>
      </dl>

      {config.isPending ? (
        <Skeleton className="h-9 w-full rounded-lg" />
      ) : showField ? (
        <div className="grid gap-2">
          <div className="flex h-5 items-center justify-between gap-2">
            <label htmlFor="onboarding-openrouter-key" className={fieldLabel}>
              OpenRouter API key
            </label>
            <a
              href={OPENROUTER_KEYS_URL}
              target="_blank"
              rel="noreferrer"
              className={cn(
                "inline-flex items-center gap-1 rounded-sm text-xs leading-5 text-fg-muted underline-offset-4 hover:text-fg hover:underline",
                focusRing
              )}
            >
              Get a key
              <ExternalLink className="size-3" aria-hidden />
              <span className="sr-only">(opens openrouter.ai in your browser)</span>
            </a>
          </div>
          <Input
            id="onboarding-openrouter-key"
            type="password"
            value={key}
            onChange={(event) => setKey(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && key.trim()) void saveAndContinue();
            }}
            placeholder="sk-or-…"
            autoComplete="new-password"
            spellCheck={false}
          />
          <p className={fieldHint}>
            Optional. Until you add one, reviews show the engine’s findings only.
          </p>
        </div>
      ) : (
        <p className="flex h-9 items-center gap-2 text-sm text-accent" role="status">
          <CheckCircle2 className="size-4" aria-hidden />A key is saved.
          <Button variant="link" size="sm" className="ml-1" onClick={() => setReplacing(true)}>
            Replace it
          </Button>
        </p>
      )}
      {saveState.kind === "error" ? <Notice tone="danger">{saveState.message}</Notice> : null}

      <StepFooter
        footer={footer}
        back={onBack}
        secondary={
          showField ? (
            <Button variant="ghost" className="h-10" onClick={onNext}>
              Skip for now
            </Button>
          ) : null
        }
        primary={
          showField ? (
            <PrimaryButton
              disabled={!key.trim() || saveState.kind === "saving"}
              onClick={() => void saveAndContinue()}
            >
              {saveState.kind === "saving" ? "Saving…" : "Save and continue"}
            </PrimaryButton>
          ) : (
            <PrimaryButton onClick={onNext}>Continue</PrimaryButton>
          )
        }
      />
    </>
  );
}

type SummaryTone = "done" | "busy" | "skipped" | "failed";

function SummaryRow({
  tone,
  title,
  children,
  extra
}: {
  tone: SummaryTone;
  title: string;
  children: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <li className="grid grid-cols-[1.25rem_minmax(0,1fr)] gap-x-3 gap-y-2 bg-surface px-4 py-3.5">
      <span className="grid h-5 place-items-center" aria-hidden>
        {tone === "done" ? (
          <CheckCircle2 className="size-4 text-accent" />
        ) : tone === "busy" ? (
          <Loader2 className="size-4 animate-spin text-fg-muted motion-reduce:animate-none" />
        ) : tone === "failed" ? (
          <CircleAlert className="size-4 text-danger" />
        ) : (
          <Minus className="size-4 text-fg-subtle" />
        )}
      </span>
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm font-medium leading-5 text-fg-secondary">{title}</span>
        <span className="text-xs leading-5 text-fg-muted">{children}</span>
      </span>
      {extra ? <span className="col-start-2">{extra}</span> : null}
    </li>
  );
}

/** The last step: what was set up, and one way into the app. */
function DoneStep({
  setup,
  ownEngine,
  settings,
  onBack,
  onDone,
  footer,
  ...heading
}: StepHeadingProps & {
  setup: EngineSetup;
  ownEngine: boolean;
  settings: AppSettings;
  onBack: () => void;
  onDone: () => void;
}) {
  const coach = useOpenRouterConfigQuery();
  const hasKey = Boolean(coach.data?.hasApiKey);
  const failed = setup.rows.find((row) => row.status === "error");
  const allInstalled =
    setup.rows.length > 0 && setup.rows.every((row) => row.status === "ready");
  const downloading = setup.phase === "downloading";

  const engines: { tone: SummaryTone; text: string } = downloading
    ? {
        tone: "busy",
        text:
          setup.stockfishPercent !== null
            ? `Downloading Stockfish (${setup.stockfishPercent}%). It carries on in the background, and Home shows the progress.`
            : setup.engineReady
              ? "Stockfish is ready. Maia is still downloading in the background; Home shows the progress."
              : "Installing Stockfish. Home shows the progress."
      }
    : setup.engineReady
      ? {
          tone: "done",
          text: allInstalled ? "Stockfish and Maia are ready." : "An engine is ready for Game review."
        }
      : failed
        ? { tone: "failed", text: `${failed.label} didn’t download. You can retry it from Home.` }
        : setup.phase === "checking"
          ? { tone: "busy", text: "Checking…" }
          : {
              tone: "skipped",
              text: ownEngine
                ? "Add your own engine in Settings, Engines."
                : "Skipped. Home offers the download whenever you want it."
            };

  const preset = nearestLevelPreset(settings.reviewPlayerRating);
  const exact = preset.rating === settings.reviewPlayerRating;
  const side = settings.reviewPlayerColor === "black" ? "Black" : "White";

  return (
    <>
      <StepHeader {...heading} title="You’re all set">
        <p>Here’s what is set up. You can change any of it later in Settings.</p>
      </StepHeader>

      <ul
        aria-label="Setup summary"
        className="grid gap-px overflow-hidden rounded-xl border border-line bg-line-subtle"
      >
        <SummaryRow
          tone={engines.tone}
          title="Engines"
          extra={
            downloading && setup.stockfishPercent !== null ? (
              <Progress value={setup.stockfishPercent} aria-label="Stockfish download" />
            ) : null
          }
        >
          <span role="status">{engines.text}</span>
        </SummaryRow>
        <SummaryRow tone="done" title="Your level">
          {exact
            ? `${preset.rating}, ${preset.label.toLowerCase()}. Explanations are written for ${side}.`
            : `${settings.reviewPlayerRating}. Explanations are written for ${side}.`}
        </SummaryRow>
        <SummaryRow tone={hasKey ? "done" : "skipped"} title="AI coach">
          {hasKey
            ? "Your OpenRouter key is saved. Reviews come with explanations."
            : "Skipped. Reviews show the engine’s findings; add a key in Settings, Commentary."}
        </SummaryRow>
      </ul>

      <StepFooter
        footer={footer}
        back={onBack}
        primary={<PrimaryButton onClick={onDone}>Start using Chaturanga</PrimaryButton>}
      />
    </>
  );
}

/* ------------------------------------------------------------------ focus */

const FOCUSABLE =
  'a[href], button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex="-1"])';

/** Keeps Tab inside the welcome. */
function trapTab(event: KeyboardEvent<HTMLElement>, root: HTMLElement | null) {
  if (!root) return;
  const focusable = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter(
    (element) => element.offsetParent !== null
  );
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  if (!first || !last) return;
  const active = document.activeElement;
  if (event.shiftKey && (active === first || !root.contains(active) || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
