import { useState } from "react";
import { Upload } from "lucide-react";
import { useGameStore } from "../../stores/game-store";

export function PgnImportDialog({ onClose }: { onClose: () => void }) {
  const [pgn, setPgn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadGame = useGameStore((state) => state.loadGame);

  async function importPgn(text: string) {
    try {
      const imported = await window.chaturanga.games.importPgn({ pgn: text });
      loadGame(imported.game);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import PGN");
    }
  }

  async function openFile() {
    const file = await window.chaturanga.files.openPgnFile();
    if (!file) return;
    setPgn(file.contents);
    await importPgn(file.contents);
  }

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <div className="modal-header">
          <h2>Import PGN</h2>
          <button onClick={onClose}>Close</button>
        </div>
        <textarea
          value={pgn}
          onChange={(event) => setPgn(event.target.value)}
          placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 2. Nf3 *"
        />
        {error ? <p className="error">{error}</p> : null}
        <div className="dialog-actions">
          <button onClick={openFile}>
            <Upload size={17} />
            Open file
          </button>
          <button className="primary" onClick={() => importPgn(pgn)} disabled={!pgn.trim()}>
            Import
          </button>
        </div>
      </div>
    </div>
  );
}
