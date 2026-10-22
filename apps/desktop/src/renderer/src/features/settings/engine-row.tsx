import type { ReactNode } from "react";
import { Play, Star } from "lucide-react";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { MenuItem } from "@/components/ui/menu";
import { ipcErrorMessage } from "@/lib/ipc-error";

/* Pieces shared by Settings → Engines' rows: managed downloads and the engines the user added. */

export type TestResult = { ok: boolean; message: string } | null;

export function formatTestResult(
  result: { ok: boolean; name?: string; error?: string; isHumanPrediction?: boolean },
  fallbackName: string
): TestResult {
  if (!result.ok) return { ok: false, message: result.error || "Engine failed to start." };
  const name = result.name || fallbackName;
  // Maia found in an engine not named for it (Maia 3's own test reports "Maia 3").
  const detected = result.isHumanPrediction && !/maia/i.test(name) ? " (Maia detected)" : "";
  return { ok: true, message: `${name} responded${detected}.` };
}

/** Starts a saved engine for a UCI handshake; resolves with the notice to show (null outside the app). */
export async function testSavedEngine(
  engine: EngineConfig,
  displayName = engine.name
): Promise<{ result: TestResult; maiaDetected: boolean } | null> {
  if (!window.chaturanga) return null;
  try {
    const result = await window.chaturanga.engines.test(engine.id);
    return {
      result: formatTestResult(result, displayName),
      maiaDetected: result.ok && Boolean(result.isHumanPrediction)
    };
  } catch (error) {
    return {
      result: { ok: false, message: ipcErrorMessage(error) || "The engine test failed." },
      maiaDetected: false
    };
  }
}

/**
 * The ⋯ items every saved engine has: Set as default (the disabled "Default engine" once it is;
 * not for Maia 3, which only plays and predicts human moves), and Test.
 */
export function savedEngineMenuItems({
  engine,
  disabled,
  onSetDefault,
  onTest
}: {
  engine: EngineConfig;
  disabled: boolean;
  onSetDefault: () => void;
  onTest: () => void;
}): MenuItem[] {
  const test: MenuItem = { label: "Test", icon: <Play />, onSelect: onTest, disabled };
  if (engine.runtime === "maia3") return [test];
  return [
    {
      label: engine.isDefault ? "Default engine" : "Set as default",
      icon: <Star />,
      onSelect: onSetDefault,
      disabled: disabled || engine.isDefault
    },
    test
  ];
}

export function EngineRowText({
  name,
  detail,
  detailTitle = detail,
  badges
}: {
  name: string;
  /** Version or executable path, under the name; omitted when there is none. */
  detail?: string | null;
  /** The detail's tooltip, where the detail is shortened (a custom file's name for its path). */
  detailTitle?: string | null;
  badges?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 flex-1 gap-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-fg">{name}</span>
        {badges}
      </div>
      {detail ? (
        <span
          className="truncate font-mono text-2xs text-fg-subtle"
          title={detailTitle ?? undefined}
        >
          {detail}
        </span>
      ) : null}
    </div>
  );
}

/**
 * A row's trailing actions in fixed 32px slots, the primary action (a download, or the spinner while
 * busy) then the ⋯ menu, each left empty when absent, so every row's actions line up.
 */
export function EngineRowActions({ primary, menu }: { primary?: ReactNode; menu?: ReactNode }) {
  return (
    <div className="flex shrink-0 items-center gap-1">
      <span className="grid size-8 place-items-center">{primary}</span>
      <span className="grid size-8 place-items-center">{menu}</span>
    </div>
  );
}
