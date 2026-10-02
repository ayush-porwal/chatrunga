import { useEffect, useRef, useState } from "react";
import { Upload } from "lucide-react";
import type { ImportedGame } from "@chaturanga/shared/types/chess";
import { selectLiveGameInProgress, useLichessStore } from "../../stores/lichess-store";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/input";
import { Notice } from "@/components/ui/notice";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { flushGameAutosave } from "../../app/useGameAutosave";

/** Paste or open a PGN; the game goes to App (`onImported`), which puts it on the board. */
export function PgnImportDialog({ onClose, onImported }: { onClose: () => void; onImported: (imported: ImportedGame) => void }) {
  const [pgn, setPgn] = useState("");
  const [error, setError] = useState<string | null>(null);
  // One import at a time (a second click while one runs would import twice).
  const [busy, setBusy] = useState(false);
  // Closed while an import was loading (a Lichess game started and took the board): drop it, even
  // if that game has already ended. A game on right now also keeps the board before the dialog closes.
  const open = useRef(true);
  useEffect(() => {
    open.current = true;
    return () => {
      open.current = false;
    };
  }, []);

  async function importPgn(text: string) {
    if (!window.chaturanga) {
      setError("PGN import requires the desktop app.");
      return;
    }
    setBusy(true);
    try {
      // Pending edits first: the library's check for a copy must see the board as it is.
      await flushGameAutosave();
      const imported = await window.chaturanga.games.importPgn({ pgn: text });
      if (!open.current || selectLiveGameInProgress(useLichessStore.getState())) return;
      onImported(imported);
      onClose();
    } catch (err) {
      if (open.current) setError(ipcErrorMessage(err) || "Failed to import PGN");
    } finally {
      if (open.current) setBusy(false);
    }
  }

  async function openFile() {
    if (!window.chaturanga) {
      setError("Opening files requires the desktop app.");
      return;
    }
    try {
      const file = await window.chaturanga.files.openPgnFile();
      if (!file) return;
      setPgn(file.contents);
      await importPgn(file.contents);
    } catch (err) {
      setError(ipcErrorMessage(err) || "Couldn't open that file.");
    }
  }

  return (
    <Dialog
      title="Import PGN"
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => void openFile()}>
            <Upload />
            Open file
          </Button>
          <Button type="button" variant="primary" size="sm" onClick={() => void importPgn(pgn)} disabled={busy || !pgn.trim()}>
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
