import { Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useMaia3Download } from "../settings/use-maia3-download";

/**
 * Where Review needs Maia and Maia 3 isn't installed: "Maia 3 is available" and its Download
 * button (with the download's size), then its progress, or why it failed with a retry. `line`: one
 * line of small text (the charts' difficulty strip); `panel`: a block with what Maia adds (the
 * Engine tab); `button`: the button alone (a settings row, whose label says the rest).
 */
export function MaiaDownloadPrompt({
  variant,
  className
}: {
  variant: "line" | "panel" | "button";
  className?: string;
}) {
  const { state, percent, size, error, start } = useMaia3Download();
  if (state === "installed") return null;
  const downloading = state === "downloading";
  const label = downloading
    ? `Downloading… ${percent}%`
    : error
      ? "Retry download"
      : size
        ? `Download (${size})`
        : "Download";

  if (variant === "line")
    return (
      <p className={cn("text-2xs text-fg-subtle", className)} data-maia-prompt>
        {error ? (
          <span className="text-danger">Maia 3 didn&apos;t download: {error} </span>
        ) : (
          "Maia 3 is available · "
        )}
        <button
          type="button"
          disabled={downloading || state === "unknown"}
          className="text-accent underline-offset-2 tabular-nums hover:underline focus-visible:underline focus-visible:outline-none disabled:text-fg-muted disabled:no-underline"
          onClick={start}
        >
          {label}
        </button>
      </p>
    );

  const button = (
    <Button
      type="button"
      variant={variant === "panel" ? "primary" : "outline"}
      size="sm"
      disabled={downloading || state === "unknown"}
      className="tabular-nums"
      onClick={start}
    >
      {downloading ? null : <Download />}
      {label}
    </Button>
  );
  if (variant === "button")
    return (
      <span className={cn("inline-flex items-center gap-2", className)}>
        {error ? (
          <span className="max-w-48 truncate text-xs text-danger" title={error}>
            {error}
          </span>
        ) : null}
        {button}
      </span>
    );
  return (
    <div className={cn("grid justify-items-center gap-2 px-4 text-center", className)}>
      <p className="text-sm font-medium text-fg">Maia 3 is available</p>
      <p className="max-w-72 text-xs text-fg-muted">
        Human moves, and how often players at each rating find them.
      </p>
      {error ? (
        <p className="max-w-72 text-xs text-danger" role="alert">
          {error}
        </p>
      ) : null}
      {button}
    </div>
  );
}
