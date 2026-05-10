import { useAnalysisStore } from "../../stores/analysis-store";

export function EngineStatusPanel() {
  const { status, latestInfo, bestMove, error } = useAnalysisStore();
  const score = latestInfo?.score
    ? latestInfo.score.type === "cp"
      ? `${(latestInfo.score.value / 100).toFixed(2)}`
      : `M${latestInfo.score.value}`
    : "—";

  return (
    <div className="panel-section">
      <h2>Engine</h2>
      <div className="engine-status">
        <span>Status</span>
        <strong>{status}</strong>
        <span>Depth</span>
        <strong>{latestInfo?.depth ?? "—"}</strong>
        <span>Score</span>
        <strong>{score}</strong>
        <span>Best</span>
        <strong>{bestMove ?? latestInfo?.pv?.[0] ?? "—"}</strong>
      </div>
      {latestInfo?.pv?.length ? <p className="pv">{latestInfo.pv.slice(0, 8).join(" ")}</p> : null}
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
