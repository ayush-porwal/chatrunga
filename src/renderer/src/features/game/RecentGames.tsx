import { useGamesQuery } from "../../queries/api";
import { useGameStore } from "../../stores/game-store";

export function RecentGames() {
  const games = useGamesQuery();
  const loadGame = useGameStore((state) => state.loadGame);

  async function openGame(id: string) {
    const saved = await window.chaturanga.games.get(id);
    loadGame({
      id: saved.id,
      source: saved.source,
      headers: {
        event: saved.event,
        site: saved.site,
        date: saved.date,
        round: saved.round,
        white: saved.white,
        black: saved.black,
        result: saved.result
      },
      rootFen: saved.initialFen ?? saved.moveTree[0]?.fenAfter,
      currentFen: saved.currentFen,
      currentNodeId: saved.moveTree.at(-1)?.id ?? "root",
      moveTree: saved.moveTree,
      pgn: saved.pgn
    });
  }

  return (
    <div className="panel-section">
      <h2>Recent games</h2>
      {games.data?.length ? (
        <div className="recent-list">
          {games.data.slice(0, 8).map((game) => (
            <button key={game.id} onClick={() => openGame(game.id)}>
              <strong>{game.white || "White"} vs {game.black || "Black"}</strong>
              <span>{game.event || game.source} · {game.result || "*"}</span>
            </button>
          ))}
        </div>
      ) : (
        <p className="empty">Saved games will appear here.</p>
      )}
    </div>
  );
}
