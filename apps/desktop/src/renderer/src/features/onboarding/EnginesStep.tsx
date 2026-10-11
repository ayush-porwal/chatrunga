import { useEffect, useRef } from "react";
import { ArrowRight, Check, CircleAlert, Download, Info, Loader2, RotateCcw } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSize, setupRowPercent, type SetupRow } from "@/lib/engine-assets";
import { EngineAvatar } from "../analysis/EngineAvatar";
import {
  ENGINE_ROW_NAMES,
  downloadFailureReason,
  enginesView,
  listedReadyEngine,
  readyEngineRow,
  type EnginesView
} from "./onboarding-state";
import { ProgressRing } from "./ProgressRing";
import { StepBand, StepIconButton, StepPill, StepRow, StepRows } from "./step-parts";
import {
  PrimaryButton,
  SecondaryButton,
  StepFooter,
  StepHeader,
  type StepHeadingProps
} from "./StepChrome";
import type { EngineSetup } from "./useEngineSetup";

const avatar = <EngineAvatar size="lg" className="size-[48px] rounded-[12px]" />;

export function EnginesStep({
  setup,
  onBack,
  onNext,
  footer,
  ...heading
}: StepHeadingProps & {
  setup: EngineSetup;
  onBack: () => void;
  onNext: () => void;
}) {
  // "Download" turns into "Continue": keyboard focus follows it instead of dropping to the page.
  const continueRef = useRef<HTMLButtonElement | null>(null);
  const focusContinue = useRef(false);
  useEffect(() => {
    if (!setup.offer && focusContinue.current) {
      focusContinue.current = false;
      continueRef.current?.focus();
    }
  }, [setup.offer]);
  const view = enginesView(setup);
  const ready =
    view === "list" &&
    !setup.offer &&
    setup.phase !== "downloading" &&
    setup.rows.every((row) => row.status === "ready");
  // While checking, Download waits (dimmed) for what there is to download.
  const download = setup.offer || view === "checking";
  return (
    <>
      <StepHeader {...heading} title={ready ? "Engines are ready" : "Engines"}>
        {ready ? null : <p>Free, and they run on this computer.</p>}
      </StepHeader>

      <EngineList setup={setup} view={view} />

      <StepFooter
        footer={footer}
        back={onBack}
        // Setup is optional: while Download is offered, Skip moves on without it.
        secondary={download ? <SecondaryButton onClick={onNext}>Skip</SecondaryButton> : undefined}
        primary={
          download ? (
            <PrimaryButton
              disabled={!setup.offer}
              onClick={() => {
                focusContinue.current = document.activeElement instanceof HTMLButtonElement;
                setup.start();
              }}
            >
              <Download />
              Download
            </PrimaryButton>
          ) : (
            <PrimaryButton ref={continueRef} onClick={onNext}>
              <ArrowRight />
              Continue
            </PrimaryButton>
          )
        }
      />
    </>
  );
}

function EngineList({ setup, view }: { setup: EngineSetup; view: EnginesView }) {
  switch (view) {
    case "checking":
      return (
        <ul
          aria-busy="true"
          aria-label="Checking engines"
          className="overflow-hidden rounded-[12px] border border-line"
        >
          {[0, 1].map((index) => (
            <li
              key={index}
              className="flex items-center gap-[16px] border-t border-line-subtle px-[20px] py-[18px] first:border-t-0"
            >
              <Skeleton as="span" className="size-[48px] rounded-[12px]" />
              <span className="grid flex-1 gap-[8px]">
                <Skeleton as="span" className="h-[12px] w-2/5 rounded-[5px]" />
                <Skeleton as="span" className="h-[10px] w-3/5 rounded-[5px]" />
              </span>
            </li>
          ))}
        </ul>
      );
    case "check-failed":
      return (
        <StepBand
          tone="danger"
          icon={<CircleAlert />}
          action={
            <StepIconButton
              label="Try again"
              tooltip="Try again"
              icon={<RotateCcw />}
              onClick={setup.recheck}
            />
          }
        >
          Couldn’t check the engines.
        </StepBand>
      );
    case "none":
      return (
        <StepBand tone="info" icon={<Info />}>
          No engine downloads for this computer. Add one in Settings → Engines.
        </StepBand>
      );
    case "list":
      return <EngineRows setup={setup} />;
  }
}

function EngineRows({ setup }: { setup: EngineSetup }) {
  const engine = listedReadyEngine(setup.rows, setup.engine);
  const own = engine ? readyEngineRow(engine) : null;
  return (
    <StepRows label="Engines">
      {engine && own ? (
        <StepRow
          lead={
            <EngineAvatar
              imagePath={engine.imagePath}
              size="lg"
              className="size-[48px] rounded-[12px]"
            />
          }
          title={own.name}
          detail={own.detail}
          end={<ReadyStatus />}
        />
      ) : null}
      {setup.rows.map((row) => (
        <StepRow
          key={row.key}
          lead={avatar}
          title={ENGINE_ROW_NAMES[row.key].name}
          detail={ENGINE_ROW_NAMES[row.key].purpose}
          end={
            setup.offer ? (
              <SizePill bytes={row.bytesTotal} />
            ) : (
              <EngineRowStatus row={row} onRetry={() => setup.retry(row)} />
            )
          }
        />
      ))}
    </StepRows>
  );
}

/** Where a started download is: queued, its progress ring, ready, or failed (with Retry). */
function EngineRowStatus({ row, onRetry }: { row: SetupRow; onRetry: () => void }) {
  const name = ENGINE_ROW_NAMES[row.key].name;
  switch (row.status) {
    case "pending":
      return <span role="status">Queued</span>;
    case "downloading":
      return <ProgressRing value={setupRowPercent(row)} label={`${name} download`} />;
    case "verifying":
    case "installing":
      return (
        <span role="status" className="flex items-center gap-[6px]">
          <Loader2 className="size-[14px] animate-spin motion-reduce:animate-none" aria-hidden />
          {row.status === "verifying" ? "Verifying" : "Installing"}
        </span>
      );
    case "ready":
      return <ReadyStatus />;
    case "error":
      return (
        <>
          <span role="status" className="inline-flex items-center gap-[5px] text-danger">
            <CircleAlert className="size-[14px]" aria-hidden />
            {downloadFailureReason(row.errorMessage)}
          </span>
          <StepIconButton
            label={`Retry ${name}`}
            tooltip="Retry"
            icon={<RotateCcw />}
            onClick={onRetry}
          />
        </>
      );
  }
}

function SizePill({ bytes }: { bytes: number }) {
  const size = formatSize(bytes);
  return size ? <StepPill>{size}</StepPill> : null;
}

function ReadyStatus() {
  return (
    <span role="status" className="inline-flex items-center gap-[5px] text-accent-fg">
      <Check className="onb-pop size-[14px] text-accent" aria-hidden />
      Ready
    </span>
  );
}
