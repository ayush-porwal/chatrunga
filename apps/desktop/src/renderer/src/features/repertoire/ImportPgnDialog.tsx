import { useMemo, useState } from "react";
import { buildChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type {
  ImportPreview,
  ImportResult,
  RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { useRepertoireQuery } from "../../queries/repertoire";
import { suggestedColor, suggestedName } from "./import-inference";
import { PgnInputActions, PgnInputBody } from "./ImportPgnInput";
import { ImportPreviewActions, ImportPreviewBody } from "./ImportPgnPreview";
import { useImportGameList } from "./useImportGameList";
import { useImportJob } from "./useImportJob";

/**
 * Import PGN into a repertoire (design §10): paste or open a file, preview every game (title,
 * kind, moves, warnings and the illegal branches left out), then commit the selected games as
 * chapters in one step. While the PGN is parsed (in a worker) its progress shows with a Cancel
 * button; closing before the commit cancels the pending or running job. While the commit runs the
 * dialog can't be closed (it can't be cancelled once the writer has started). Without a
 * repertoire (`repertoireId` null) it makes a new one: its name and colour are suggested from the
 * PGN (the most common opening family; the Orientation tag, else the side that branches less).
 */
export function ImportPgnDialog({
  repertoireId,
  onClose,
  onImported
}: {
  /** Null: a new repertoire, named and coloured in the preview. */
  repertoireId: string | null;
  onClose: () => void;
  onImported: (result: ImportResult) => void;
}) {
  const detail = useRepertoireQuery(repertoireId);
  const games = useImportGameList();
  /** A new repertoire's name and colour, suggested from each preview (then the user's). */
  const [created, setCreated] = useState<{ name: string; color: RepertoireColor }>({
    name: "",
    color: "white"
  });
  const onPreviewed = (next: ImportPreview) => {
    games.reset(next);
    setCreated({ name: suggestedName(next.games), color: suggestedColor(next.games) });
  };
  const job = useImportJob({
    repertoireId,
    revision: detail.data?.revision,
    onPreviewed,
    onImported
  });
  const { preview, committing } = job;
  const [pgn, setPgn] = useState("");

  const color = repertoireId === null ? created.color : (detail.data?.color ?? null);
  const newRepertoire = repertoireId === null ? { ...created, onChange: setCreated } : null;

  // Only games with illegal branches need a lookup (to find each branch's node); building one per
  // game would index every move of a large import on the renderer thread.
  const lookups = useMemo(
    () =>
      preview?.games.map((game) =>
        game.tree.length && game.invalidBranches.length ? buildChapterLookup(game) : null
      ) ?? [],
    [preview]
  );

  async function chooseFile() {
    job.setError(null);
    try {
      const file = await window.chaturanga?.files.openPgnFile();
      if (!file) return;
      setPgn(file.contents);
      job.runPreview(file.contents);
    } catch (cause) {
      job.setError(ipcErrorMessage(cause) || "Couldn't open that file.");
    }
  }

  return (
    <Dialog
      title="Import PGN"
      description={
        committing
          ? "Importing… please wait."
          : preview
            ? "Each game becomes a chapter. Choose what to import."
            : "Paste PGN or open a file; every game in it is read."
      }
      // No close (×, Escape, backdrop) while the commit runs: it can't be cancelled then.
      onClose={committing ? undefined : onClose}
      footer={
        preview ? (
          <ImportPreviewActions
            job={job}
            games={games}
            repertoireLoaded={repertoireId === null || Boolean(detail.data)}
            create={newRepertoire && { name: newRepertoire.name, color: newRepertoire.color }}
          />
        ) : (
          <PgnInputActions job={job} pgn={pgn} onChooseFile={() => void chooseFile()} />
        )
      }
      // The preview's search and bulk actions stay put above its own scrolling list of games.
      bodyClassName={preview ? "flex flex-col gap-3 overflow-hidden" : "grid gap-3"}
    >
      {preview ? (
        <ImportPreviewBody
          preview={preview}
          games={games}
          lookups={lookups}
          color={color}
          newRepertoire={newRepertoire}
          busy={job.busy}
        />
      ) : (
        <PgnInputBody job={job} pgn={pgn} onPgnChange={setPgn} />
      )}
      {job.error ? (
        <Notice tone="danger" className="shrink-0">
          {job.error}
        </Notice>
      ) : null}
    </Dialog>
  );
}
