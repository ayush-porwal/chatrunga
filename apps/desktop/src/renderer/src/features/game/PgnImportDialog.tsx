import { useState } from "react";
import { Upload } from "lucide-react";
import { useGameStore } from "../../stores/game-store";
import { useReviewStore } from "../../stores/review-store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";

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
    <Dialog
      title="Import PGN"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={() => void openFile()}>
            <Upload />
            Open file
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={() => void importPgn(pgn)} disabled={!pgn.trim()}>
            Import
          </Button>
        </>
      }
      bodyClassName="grid gap-3"
    >
      <Textarea
        aria-label="PGN text"
        autoFocus
        value={pgn}
        onChange={(event) => setPgn(event.target.value)}
        placeholder={'[Event "Example"]\n\n1. e4 e5 2. Nf3 *'}
      />
      {error ? <Notice tone="danger">{error}</Notice> : null}
    </Dialog>
  );
}
