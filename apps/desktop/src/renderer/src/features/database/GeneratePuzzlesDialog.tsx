import { useId, useState, type ReactNode } from "react";
import { Loader2, Play } from "lucide-react";
import {
  GAME_PUZZLE_DEPTH_PRESETS,
  GAME_PUZZLE_DEPTHS,
  GAME_PUZZLE_GAME_LIMITS,
  GAME_PUZZLE_KINDS,
  GAME_PUZZLE_SOURCES,
  type GamePuzzleDepthPreset,
  type GamePuzzleSettings
} from "@chaturanga/shared/types/game-puzzles";
import { RATING_MODE_LABELS, RATING_MODES } from "@chaturanga/shared/types/ratings";
import { ChipButton } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { SettingRow } from "@/components/ui/field";
import { Notice } from "@/components/ui/notice";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { fieldLabel } from "@/lib/ui";
import { useMaia3Installed } from "../../queries/maia";
import {
  useGamePuzzleCountQuery,
  useGamePuzzleLastSettingsQuery,
  useStartGamePuzzlesMutation
} from "../../queries/game-puzzles";
import { MaiaDownloadPrompt } from "../game-review/MaiaDownloadPrompt";
import { GAME_PUZZLE_KIND_PLURALS, GAME_PUZZLE_SOURCE_LABELS } from "../puzzles/game-puzzle-set";
import {
  canStartGeneration,
  gameCountText,
  kindAvailable,
  limitChoice,
  limitFromChoice,
  settingsToStart,
  toggled
} from "./generate-puzzles";

const limitOptions = [
  ...GAME_PUZZLE_GAME_LIMITS.map((limit) => ({ value: String(limit), label: String(limit) })),
  { value: "all", label: "All" }
];

const depthLabels: Record<GamePuzzleDepthPreset, string> = {
  quick: "Quick",
  standard: "Standard",
  deep: "Deep"
};
const depthOptions = GAME_PUZZLE_DEPTH_PRESETS.map((preset) => ({
  value: preset,
  label: depthLabels[preset]
}));

/**
 * Generate puzzles: which games (sources, time controls, how many, skipping processed ones), which
 * kinds of puzzle, and how deep the engine searches; how many games match, then Start, which queues
 * them and closes. Opens on the settings used last. `maiaInstalled`: the card's summary says
 * whether Maia 3 is installed (the engines list says so too once it loads).
 */
export function GeneratePuzzlesDialog({
  maiaInstalled,
  onClose
}: {
  maiaInstalled: boolean;
  onClose: () => void;
}) {
  const last = useGamePuzzleLastSettingsQuery();
  return last.data ? (
    <GenerateForm initial={last.data} maiaInstalled={maiaInstalled} onClose={onClose} />
  ) : (
    <Dialog
      title="Generate puzzles"
      onClose={onClose}
      footer={
        <Button type="button" variant="outline" size="sm" onClick={onClose}>
          Cancel
        </Button>
      }
    >
      {last.isError ? (
        <Notice tone="danger">
          {ipcErrorMessage(last.error) || "The last settings couldn't be read."}
        </Notice>
      ) : (
        <div className="grid gap-3" aria-busy="true">
          <Skeleton className="h-9" />
          <Skeleton className="h-9" />
          <Skeleton className="h-24" />
        </div>
      )}
    </Dialog>
  );
}

function GenerateForm({
  initial,
  maiaInstalled: summaryMaia,
  onClose
}: {
  initial: GamePuzzleSettings;
  maiaInstalled: boolean;
  onClose: () => void;
}) {
  const [settings, setSettings] = useState(initial);
  const maiaInstalled = useMaia3Installed() ?? summaryMaia;
  const toStart = settingsToStart(settings, maiaInstalled);
  const count = useGamePuzzleCountQuery(toStart);
  const start = useStartGamePuzzlesMutation();
  const update = (patch: Partial<GamePuzzleSettings>) =>
    setSettings((current) => ({ ...current, ...patch }));
  const skipId = useId();
  const depth = GAME_PUZZLE_DEPTHS[settings.depth];
  const ready = canStartGeneration(toStart, count.data) && !start.isPending;

  return (
    <Dialog
      title="Generate puzzles"
      description="Stockfish and Maia 3 look for puzzles in your games, one game at a time, on this computer."
      onClose={onClose}
      bodyClassName="grid gap-5"
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!ready}
            onClick={() => start.mutate(toStart, { onSuccess: onClose })}
          >
            {start.isPending ? <Loader2 className="animate-spin" /> : <Play />}
            Start
          </Button>
        </>
      }
    >
      <Group label="Games from">
        <Chips
          items={GAME_PUZZLE_SOURCES}
          selected={settings.sources}
          label={(source) => GAME_PUZZLE_SOURCE_LABELS[source]}
          onChange={(sources) => update({ sources })}
        />
      </Group>
      <Group label="Time controls">
        <Chips
          items={RATING_MODES}
          selected={settings.timeControls}
          label={(mode) => RATING_MODE_LABELS[mode]}
          onChange={(timeControls) => update({ timeControls })}
        />
      </Group>
      <Group label="How many" hint="Newest first">
        <SegmentedControl
          ariaLabel="How many games"
          size="sm"
          options={limitOptions}
          value={limitChoice(settings.limit)}
          onChange={(choice) => update({ limit: limitFromChoice(choice) })}
        />
      </Group>
      <SettingRow
        label="Skip games already processed"
        htmlFor={skipId}
        className="-my-1.5"
        control={
          <Switch
            id={skipId}
            checked={settings.skipProcessed}
            onCheckedChange={(skipProcessed) => update({ skipProcessed })}
          />
        }
      />
      <Group label="Puzzle kinds">
        <div className="grid gap-1.5">
          {GAME_PUZZLE_KINDS.map((kind) => {
            const available = kindAvailable(kind, maiaInstalled);
            return (
              <label
                key={kind}
                className="flex items-center gap-2 text-sm text-fg-secondary has-disabled:text-fg-subtle"
              >
                <input
                  type="checkbox"
                  className="size-4 accent-accent"
                  checked={available && settings.kinds.includes(kind)}
                  disabled={!available}
                  onChange={() =>
                    update({ kinds: toggled(settings.kinds, kind, GAME_PUZZLE_KINDS) })
                  }
                />
                {GAME_PUZZLE_KIND_PLURALS[kind]}
              </label>
            );
          })}
          {maiaInstalled ? null : <MaiaDownloadPrompt variant="line" className="pl-6" />}
        </div>
      </Group>
      <Group label="Depth" hint={`Scan depth ${depth.scan} · check depth ${depth.verify}`}>
        <SegmentedControl
          ariaLabel="Depth"
          size="sm"
          options={depthOptions}
          value={settings.depth}
          onChange={(value) => update({ depth: value })}
        />
      </Group>
      <p className="text-sm text-fg-muted" aria-live="polite">
        {count.isError
          ? `Couldn't count the games: ${ipcErrorMessage(count.error) || "unknown error"}`
          : count.data
            ? gameCountText(count.data)
            : "Counting games…"}
      </p>
      {start.isError ? (
        <Notice tone="danger">{ipcErrorMessage(start.error) || "The queue couldn't start."}</Notice>
      ) : null}
    </Dialog>
  );
}

/** A labelled group of controls (role="group"), with the field label style. */
function Group({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  const labelId = useId();
  return (
    <div role="group" aria-labelledby={labelId} className="grid min-w-0 content-start gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span id={labelId} className={fieldLabel}>
          {label}
        </span>
        {hint ? <span className="text-2xs text-fg-subtle">{hint}</span> : null}
      </span>
      {children}
    </div>
  );
}

/** Chips that toggle each item in or out of `selected` (kept in `items`' order). */
function Chips<T extends string>({
  items,
  selected,
  label,
  onChange
}: {
  items: readonly T[];
  selected: readonly T[];
  label: (item: T) => string;
  onChange: (value: T[]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <ChipButton
          key={item}
          selected={selected.includes(item)}
          onClick={() => onChange(toggled(selected, item, items))}
        >
          {label(item)}
        </ChipButton>
      ))}
    </div>
  );
}
