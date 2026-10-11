import { useEffect, useRef } from "react";
import { CheckCircle2, CircleAlert, Download, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSize, setupRowPercent, type SetupRow } from "@/lib/engine-assets";
import { fieldHint } from "@/lib/ui";
import { PrimaryButton, StepFooter, StepHeader, type StepHeadingProps } from "./StepChrome";
import type { EngineSetup } from "./useEngineSetup";

const rowPurpose: Record<SetupRow["key"], string> = {
  stockfish: "Scores every move and finds the best ones",
  maia: "Predicts what players at each rating would play",
  lc0: "A second opinion from a neural network"
};

/**
 * What the step shows under its header: placeholders while the engines are checked, a note when
 * there is nothing to download (the user's own engine, or no downloads here at all), or the list.
 */
type EngineListView = "checking" | "own-engine" | "unavailable" | "list";

function engineListView(setup: EngineSetup): EngineListView {
  if (!setup.statusLoaded) return "checking";
  if (setup.rows.length) return "list";
  // Nothing to download or list, but the user's own engine already runs Game review.
  return setup.status !== null && setup.engineReady ? "own-engine" : "unavailable";
}

export function EnginesStep({
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
  const view = engineListView(setup);
  const allInstalled =
    view === "own-engine" ||
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

      <EngineList setup={setup} view={view} />

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

function EngineList({ setup, view }: { setup: EngineSetup; view: EngineListView }) {
  switch (view) {
    case "checking":
      return (
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
      );
    case "own-engine":
      return (
        <Notice tone="info">
          Game review will use the engine you added. You can add more in Settings.
        </Notice>
      );
    case "unavailable":
      return (
        <Notice tone="info">
          {setup.status
            ? "No engine downloads are available for this computer. You can add your own engine in Settings."
            : "Engine downloads need the desktop app. You can add your own engine in Settings."}
        </Notice>
      );
    case "list":
      return (
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
                ? "Lc0, an optional neural-network engine, can be added later in Settings → Engines."
                : "Lc0, the neural-network engine Maia runs in, has no automatic download for this computer. Install it yourself later and add it in Settings to use Maia."}
            </p>
          ) : null}
        </div>
      );
  }
}

/** The bar under a row: full (and red) on failure, indeterminate while verifying or installing. */
function rowProgress(row: SetupRow): number | null {
  if (row.status === "error") return 100;
  if (row.status === "verifying" || row.status === "installing") return null;
  return setupRowPercent(row);
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
          ) : (
            <EngineRowStatus row={row} onRetry={onRetry} />
          )}
        </span>
      </div>
      {!offer && row.status !== "ready" ? (
        <Progress
          value={rowProgress(row)}
          tone={row.status === "error" ? "danger" : "accent"}
          aria-label={`${row.label} download`}
        />
      ) : null}
    </li>
  );
}

/** Where a started download is: queued, working on it, ready, or failed (with Retry). */
function EngineRowStatus({ row, onRetry }: { row: SetupRow; onRetry: () => void }) {
  switch (row.status) {
    case "pending":
      return <span className="text-fg-subtle">Queued</span>;
    case "downloading":
      return <WorkingStatus label={`${setupRowPercent(row)}%`} />;
    case "verifying":
      return <WorkingStatus label="Verifying" />;
    case "installing":
      return <WorkingStatus label="Installing" />;
    case "ready":
      return (
        <span className="flex items-center gap-1.5 text-accent">
          <CheckCircle2 className="size-4 animate-pop-in" aria-hidden />
          Ready
        </span>
      );
    case "error":
      return (
        <>
          <span className="flex items-center gap-1.5 text-danger">
            <CircleAlert className="size-4" aria-hidden />
            Failed
          </span>
          <Button variant="outline" size="xs" onClick={onRetry} aria-label={`Retry ${row.label}`}>
            <RefreshCw />
            Retry
          </Button>
        </>
      );
  }
}

function WorkingStatus({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-1.5 text-fg-muted">
      <Loader2 className="size-3.5 animate-spin motion-reduce:animate-none" aria-hidden />
      {label}
    </span>
  );
}
