import type { ReactNode } from "react";
import { Bot, Play, Star } from "lucide-react";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { MenuItem } from "@/components/ui/menu";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { localImageSrc } from "@/lib/local-image";
import { cn } from "@/lib/utils";

/* Pieces shared by Settings → Engines' rows: managed downloads and the engines the user added. */

export type TestResult = { ok: boolean; message: string } | null;

export function formatTestResult(
  result: { ok: boolean; name?: string; error?: string; isHumanPrediction?: boolean },
  fallbackName: string
): TestResult {
  return result.ok
    ? {
        ok: true,
        message: `${result.name || fallbackName} responded${result.isHumanPrediction ? " (Maia detected)" : ""}.`
      }
    : { ok: false, message: result.error || "Engine failed to start." };
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

/** The ⋯ items every saved engine has: Set as default (the disabled "Default engine" once it is), and Test. */
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
  return [
    {
      label: engine.isDefault ? "Default engine" : "Set as default",
      icon: <Star />,
      onSelect: onSetDefault,
      disabled: disabled || engine.isDefault
    },
    { label: "Test", icon: <Play />, onSelect: onTest, disabled }
  ];
}

export function EngineRowText({
  name,
  detail,
  badges
}: {
  name: string;
  /** Version or executable path, under the name; omitted when there is none. */
  detail?: string | null;
  badges?: ReactNode;
}) {
  return (
    <div className="grid min-w-0 flex-1 gap-0.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="truncate font-medium text-fg">{name}</span>
        {badges}
      </div>
      {detail ? (
        <span className="truncate font-mono text-2xs text-fg-subtle" title={detail}>
          {detail}
        </span>
      ) : null}
    </div>
  );
}

export function EngineImagePreview({
  imagePath,
  name,
  size = "sm"
}: {
  imagePath: string | null;
  name: string;
  size?: "sm" | "md";
}) {
  const src = localImageSrc(imagePath);
  return (
    <span
      className={cn(
        // `relative`: contains the sr-only label (absolute), which otherwise stretches the page scroll height.
        "relative flex shrink-0 items-center justify-center overflow-hidden rounded-lg border border-line bg-surface-sunken text-fg-subtle",
        size === "md" ? "size-9" : "size-8"
      )}
    >
      {src ? (
        <img className="size-full object-cover" src={src} alt="" />
      ) : (
        <Bot className="size-4" />
      )}
      <span className="sr-only">{name} engine image</span>
    </span>
  );
}
