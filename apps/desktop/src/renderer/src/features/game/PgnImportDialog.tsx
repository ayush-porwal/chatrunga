import { useState } from "react";
import { Upload } from "lucide-react";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { Button } from "@/components/ui/button";
import { dialogActions, error as errorClass, modalBackdrop, modalPanel, sectionHeader, textarea } from "@/lib/ui";

export function PgnImportDialog({ onClose }: { onClose: () => void }) {
  const [pgn, setPgn] = useState("");
  const [error, setError] = useState<string | null>(null);
  const loadGame = useGameStore((state) => state.loadGame);

  async function importPgn(text: string) {
    if (!window.chaturanga) {
      setError("PGN import requires the desktop app.");
      return;
    }
    try {
      const imported = await window.chaturanga.games.importPgn({ pgn: text });
      useReviewStore.getState().reset();
      loadGame(imported.game);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to import PGN");
    }
  }

  async function openFile() {
    if (!window.chaturanga) {
      setError("Opening files requires the desktop app.");
      return;
    }
    const file = await window.chaturanga.files.openPgnFile();
    if (!file) return;
    setPgn(file.contents);
    await importPgn(file.contents);
  }

  return (
    <div className={modalBackdrop}>
      <div className={modalPanel}>
        <div className={sectionHeader}>
          <h2 className="text-[15px] font-semibold text-[#f4f1ea]">Import PGN</h2>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>Close</Button>
        </div>
        <textarea
          className={textarea}
          value={pgn}
          onChange={(event) => setPgn(event.target.value)}
          placeholder="[Event &quot;Example&quot;]&#10;&#10;1. e4 e5 2. Nf3 *"
        />
        {error ? <p className={errorClass}>{error}</p> : null}
        <div className={dialogActions}>
          <Button type="button" variant="outline" onClick={openFile}>
            <Upload size={17} />
            Open file
          </Button>
          <Button type="button" variant="secondary" onClick={() => importPgn(pgn)} disabled={!pgn.trim()}>
            Import
          </Button>
        </div>
      </div>
    </div>
  );
}
