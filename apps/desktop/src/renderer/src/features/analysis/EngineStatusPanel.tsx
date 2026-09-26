import { Cpu, Play } from "lucide-react";
import { formatScore } from "../game-review/review-score";
import type { EngineStatus } from "@chaturanga/shared/types/engine";
import { useAnalysisStore } from "../../stores/analysis-store";
import { useEnginesQuery } from "../../queries/api";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Notice } from "@/components/ui/notice";
import { Eyebrow } from "@/components/ui/page";
import { Stat, StatGroup } from "@/components/ui/stat";

const statusLabel: Record<EngineStatus, string> = {
  idle: "Idle",
  starting: "Starting",
  ready: "Ready",
  thinking: "Thinking",
  error: "Error"
};

const statusTone: Record<EngineStatus, "neutral" | "accent" | "danger"> = {
  idle: "neutral",
  starting: "neutral",
  ready: "neutral",
  thinking: "accent",
  error: "danger"
};

/** Workspace "Engine" tab: live search stats and principal variations (flat — the panel is the card). */
export function EngineStatusPanel({
  onStartAnalysis
}: {
  /** Shown as the idle empty-state action ("Start analysis"). Omit to hide the action. */
  onStartAnalysis?: () => void;
}) {
  const { status, latestInfo, topLines, bestMove, error, activeEngineId } = useAnalysisStore();
  const engines = useEnginesQuery();
  const engineName = engines.data?.find((engine) => engine.id === activeEngineId)?.name ?? null;
  // With MultiPV the latest info can be line 2/3 — read depth/score/best from the principal line.
  const primary = topLines.find((line) => (line.multipv ?? 1) === 1) ?? latestInfo;
  const best = bestMove ?? primary?.pv?.[0] ?? null;
  const hasData = Boolean(latestInfo || topLines.length || best);
  const idle = status === "idle" || status === "error";

  return (
    <section className="grid content-start gap-4">
      {hasData || !idle ? (
        // The tab above already says "Engine": the header names the running engine and its state.
        <div className="flex min-h-6 min-w-0 items-center justify-between gap-2">
          <span className="truncate text-xs text-fg-muted">{engineName}</span>
          <Badge tone={statusTone[status]}>{statusLabel[status]}</Badge>
        </div>
      ) : null}
      {hasData ? (
        <>
          <StatGroup>
            <Stat label="Depth" value={primary?.depth ?? "–"} mono />
            <Stat label="Score" value={primary?.score ? formatScore(primary.score, 2) : "–"} mono />
            <Stat label="Best" value={best ?? "–"} mono />
          </StatGroup>
          {topLines.length ? (
            <div className="grid gap-1">
              <Eyebrow>Lines</Eyebrow>
              <ol className="divide-y divide-line-subtle">
                {topLines.slice(0, 5).map((line) => (
                  <li
                    key={line.multipv ?? 1}
                    className="grid grid-cols-[1rem_3.5rem_minmax(0,1fr)] items-baseline gap-2 py-1.5 font-mono text-xs"
                  >
                    <span className="text-2xs text-fg-subtle">{line.multipv ?? 1}</span>
                    <span className="font-medium text-fg">{line.score ? formatScore(line.score, 2) : "–"}</span>
                    <span className="min-w-0 truncate text-fg-muted" title={line.pv?.join(" ")}>
                      {line.pv?.slice(0, 10).join(" ") || "–"}
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          ) : null}
        </>
      ) : idle ? (
        <EmptyState
          icon={<Cpu />}
          title="Engine is idle"
          description={onStartAnalysis ? "Analyze the current position." : undefined}
          action={
            onStartAnalysis ? (
              <Button type="button" variant="primary" size="sm" onClick={onStartAnalysis}>
                <Play />
                Start analysis
              </Button>
            ) : undefined
          }
          className="py-6"
        />
      ) : (
        <EmptyState
          compact
          title={status === "starting" ? "Starting engine…" : status === "thinking" ? "Thinking…" : "No analysis yet."}
        />
      )}
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </section>
  );
}
