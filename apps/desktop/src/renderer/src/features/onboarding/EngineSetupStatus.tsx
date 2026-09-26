import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { formatSize } from "@/lib/engine-assets";
import { useEngineSetup } from "./useEngineSetup";

/**
 * Where engine setup stands, as one line for Home: progress while downloads run, Retry for anything
 * that failed (Stockfish or a Maia model), a way forward when there is no engine (download or add
 * your own), and a quiet offer for Maia models still missing once an engine is ready. Nothing when
 * everything recommended is installed. Owns its subscriptions so progress never re-renders the page.
 */
export function EngineSetupLine({ onOpenEngineSettings }: { onOpenEngineSettings: () => void }) {
  const setup = useEngineSetup();
  const failed = setup.rows.find((row) => row.status === "error");

  if (setup.phase === "checking") return null;

  if (setup.phase === "downloading") {
    return (
      <div className="grid max-w-sm animate-rise-in gap-2" role="status">
        <p className="text-xs leading-5 text-fg-muted">
          {setup.stockfishPercent !== null
            ? `Stockfish is downloading (${setup.stockfishPercent}%). Reviews can start as soon as it’s ready.`
            : setup.engineReady
              ? "Finishing the Maia downloads in the background."
              : "Installing Stockfish…"}
        </p>
        {setup.stockfishPercent !== null ? (
          <Progress value={setup.stockfishPercent} aria-label="Stockfish download" />
        ) : null}
      </div>
    );
  }

  if (failed) {
    return (
      <p
        className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-fg-muted animate-rise-in"
        role="status"
      >
        <span className="text-danger">{failed.label} didn’t download.</span>
        <Button variant="outline" size="xs" onClick={() => setup.retry(failed)}>
          <RefreshCw />
          Retry
        </Button>
        {failed.key === "stockfish" && !setup.engineReady ? (
          <Button variant="link" size="sm" className="text-xs" onClick={onOpenEngineSettings}>
            Use my own engine
          </Button>
        ) : null}
      </p>
    );
  }

  const size = formatSize(setup.offerBytes);
  if (setup.engineReady) {
    // Stockfish (or another engine) works; offer whatever recommended is still missing (Maia).
    if (!setup.offer) return null;
    const labels = setup.rows.map((row) => row.label).join(" and ");
    return (
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-fg-muted animate-rise-in">
        <span>{labels} not installed yet: they show how players at your rating would play.</span>
        <Button variant="outline" size="xs" onClick={setup.start}>
          <Download />
          {size ? `Download (${size})` : "Download"}
        </Button>
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-5 text-fg-muted animate-rise-in">
      <span>Game review needs an engine.</span>
      {setup.offer ? (
        <Button variant="outline" size="xs" onClick={setup.start}>
          <Download />
          {size ? `Download Stockfish and Maia (${size})` : "Download Stockfish and Maia"}
        </Button>
      ) : null}
      <Button variant="link" size="sm" className="text-xs" onClick={onOpenEngineSettings}>
        {setup.offer ? "or add your own" : "Add an engine"}
      </Button>
    </p>
  );
}
