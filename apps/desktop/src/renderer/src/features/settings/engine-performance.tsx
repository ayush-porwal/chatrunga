import type { ComponentProps, ComponentType } from "react";
import {
  defaultEngineThreads,
  defaultSettings,
  type AppSettings
} from "@chaturanga/shared/types/settings";
import { isOneOf } from "@chaturanga/shared/types/guards";
import { SettingRow } from "@/components/ui/field";
import { Select } from "@/components/ui/input";
import { useSetSetting } from "./use-set-setting";

/*
 * The evaluation engine's Threads and Hash, shared by Settings → Engines and Analysis settings.
 * Apart from EngineSettings so the Analysis settings dialog doesn't load the whole Engines section.
 */

const HASH_SIZE_OPTIONS_MB = [64, 128, 256, 512, 1024] as const;

/** Logical cores the renderer can see; main clamps `engineThreads` to its own `os.cpus()` count. */
function logicalCores(): number {
  const cores = typeof navigator === "undefined" ? 0 : navigator.hardwareConcurrency;
  return Number.isFinite(cores) && cores > 0 ? cores : 4;
}

function formatHashSize(mb: number): string {
  return mb >= 1024 && mb % 1024 === 0 ? `${mb / 1024} GB` : `${mb} MB`;
}

/** What the Performance settings are for (Settings → Engines and Analysis settings). */
export const ENGINE_PERFORMANCE_DESCRIPTION =
  "For the evaluation engine in Game review and live analysis.";

/**
 * The evaluation engine's Threads and Hash, as two rows: Settings' own rows by default, or the
 * `Row` (same props as SettingRow) and select look of the dialog they sit in.
 */
export function EnginePerformanceRows({
  appearance,
  Row = SettingRow,
  selectClassName = "w-36"
}: {
  appearance: AppSettings;
  Row?: ComponentType<ComponentProps<typeof SettingRow>>;
  selectClassName?: string;
}) {
  const setSetting = useSetSetting();
  const cores = logicalCores();
  const autoThreads = defaultEngineThreads(cores);
  const threadOptions = Array.from({ length: cores }, (_, index) => index + 1);
  const hashOptions: number[] = isOneOf(HASH_SIZE_OPTIONS_MB, appearance.engineHashMb)
    ? [...HASH_SIZE_OPTIONS_MB]
    : [...HASH_SIZE_OPTIONS_MB, appearance.engineHashMb].sort((a, b) => a - b);
  return (
    <>
      <Row
        label="Threads"
        htmlFor="setting-engine-threads"
        description={`CPU cores the evaluation engine may use. Auto keeps one of your ${cores} free for the app.`}
        control={
          <Select
            id="setting-engine-threads"
            className={selectClassName}
            value={
              appearance.engineThreads === null
                ? "auto"
                : String(Math.min(appearance.engineThreads, cores))
            }
            onChange={(event) =>
              setSetting(
                "engineThreads",
                event.target.value === "auto" ? null : Number(event.target.value)
              )
            }
          >
            <option value="auto">Auto · {autoThreads}</option>
            {threadOptions.map((count) => (
              <option key={count} value={count}>
                {count} {count === 1 ? "thread" : "threads"}
              </option>
            ))}
          </Select>
        }
      />
      <Row
        label="Hash"
        htmlFor="setting-engine-hash"
        description={`Memory for the engine's position cache. More helps long searches. Default ${formatHashSize(defaultSettings.engineHashMb)}.`}
        control={
          <Select
            id="setting-engine-hash"
            className={selectClassName}
            value={appearance.engineHashMb}
            onChange={(event) => setSetting("engineHashMb", Number(event.target.value))}
          >
            {hashOptions.map((mb) => (
              <option key={mb} value={mb}>
                {formatHashSize(mb)}
              </option>
            ))}
          </Select>
        }
      />
    </>
  );
}
