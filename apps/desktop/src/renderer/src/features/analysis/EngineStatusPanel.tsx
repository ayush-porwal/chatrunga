import { useAnalysisStore } from "../../stores/analysis-store";
import { panel } from "@/lib/ui";

export function EngineStatusPanel() {
  const { status, latestInfo, topLines, bestMove, error } = useAnalysisStore();
  const score = latestInfo?.score
    ? latestInfo.score.type === "cp"
      ? `${(latestInfo.score.value / 100).toFixed(2)}`
      : `M${latestInfo.score.value}`
    : "—";

  return (
    <div className={`${panel} p-[13px]`}>
      <h2 className="text-[15px] font-semibold text-[#f4f1ea]">Engine</h2>
      <div className="mt-3 grid w-full min-w-0 grid-cols-[82px_minmax(0,1fr)] gap-x-3.5 gap-y-2 rounded-lg border border-white/[0.07] bg-[#151719] p-2.5">
        <span className="text-sm text-[#9d9d9d]">Status</span>
        <strong className="min-w-0 truncate text-[#f4f1ea]">{status}</strong>
        <span className="text-sm text-[#9d9d9d]">Depth</span>
        <strong className="min-w-0 truncate text-[#f4f1ea]">{latestInfo?.depth ?? "—"}</strong>
        <span className="text-sm text-[#9d9d9d]">Score</span>
        <strong className="min-w-0 truncate text-[#f4f1ea]">{score}</strong>
        <span className="text-sm text-[#9d9d9d]">Best</span>
        <strong className="min-w-0 truncate text-[#f4f1ea]">{bestMove ?? latestInfo?.pv?.[0] ?? "—"}</strong>
      </div>
      {topLines.length ? (
        <div className="mt-3 grid gap-1.5">
          {topLines.slice(0, 5).map((line) => (
            <div
              key={line.multipv ?? 1}
              className="grid grid-cols-[22px_56px_minmax(0,1fr)] items-baseline gap-2 rounded-lg border border-white/[0.07] bg-[#151719] p-2.5 font-mono text-xs text-[#c9c9c9]"
            >
              <span className="flex size-[22px] items-center justify-center rounded-full bg-[#263527] text-[11px] font-bold text-[#d7e8c5]">
                {line.multipv ?? 1}
              </span>
              <strong className="text-[#f4f1ea]">
                {line.score
                  ? line.score.type === "cp"
                    ? `${(line.score.value / 100).toFixed(2)}`
                    : `M${line.score.value}`
                  : "—"}
              </strong>
              <span className="min-w-0 truncate">{line.pv?.slice(0, 10).join(" ") || "—"}</span>
            </div>
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-3 text-[13px] text-[#ff9a8d]">{error}</p> : null}
    </div>
  );
}
