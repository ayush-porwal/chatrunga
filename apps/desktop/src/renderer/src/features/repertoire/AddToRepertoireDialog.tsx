import { BookPlus } from "lucide-react";
import type {
  AddFromGameResult,
  AddFromGameScope,
  AddFromGameSource
} from "@chaturanga/shared/types/repertoire";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { AddDestinationFields, AddScopeFields } from "./AddToRepertoireFields";
import { AddPreviewSection } from "./AddToRepertoirePreview";
import {
  useAddCommit,
  useAddDestination,
  useAddPreview,
  useAddScope,
  type AddPreselect
} from "./useAddToRepertoireForm";

/**
 * Add to repertoire (design §6.2): one dialog that picks the destination (repertoire, then a new
 * or an existing chapter), the scope (line to the selected move, its branch, or the whole game)
 * and confirms the choice policy the preview proposes (own moves ticked, opponent replies
 * covered), with what the add changes and where it differs from the repertoire. The game and its
 * review are only read; nothing is written to the game store.
 */
export function AddToRepertoireDialog({
  source,
  initialScope,
  preselect = null,
  onClose,
  onDone
}: {
  source: AddFromGameSource;
  /** A path/subtree hint at the selected move, or the whole game. */
  initialScope: AddFromGameScope;
  /** A repertoire (and chapter) chosen beforehand: one just created for this game. */
  preselect?: AddPreselect;
  onClose: () => void;
  onDone: (result: AddFromGameResult) => void;
}) {
  const desktop = Boolean(window.chaturanga?.repertoires);
  const scope = useAddScope(source, initialScope);
  const target = useAddDestination({ source, preselect, scopeChoice: scope.choice });
  const preview = useAddPreview({ desktop, source, scope: scope.scope, target });
  const add = useAddCommit({ preview, target, onDone });

  return (
    <Dialog
      title="Add to repertoire"
      description="Copies moves, comments and arrows into a chapter. The game itself stays as it is."
      onClose={onClose}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            type="button"
            variant="primary"
            size="sm"
            disabled={!add.canAdd}
            onClick={() => void add.commit()}
          >
            <BookPlus />
            {add.adding ? "Adding…" : "Add to repertoire"}
          </Button>
        </>
      }
      bodyClassName="grid gap-4"
    >
      {!desktop ? (
        <Notice tone="warn">Repertoires need the desktop app.</Notice>
      ) : target.list.isSuccess && !target.repertoires.length ? (
        <Notice tone="info">Create a repertoire first; then add games to it from here.</Notice>
      ) : null}

      <AddDestinationFields
        target={target}
        onPickRepertoire={(repertoireId) => {
          target.pickRepertoire(repertoireId);
          add.setError(null);
        }}
      />

      <AddScopeFields scope={scope} />

      {target.repertoireId && target.destination ? (
        <AddPreviewSection preview={preview} destinationKind={target.kind} />
      ) : null}

      {add.notice ? <Notice tone="info">{add.notice}</Notice> : null}
      {add.error ? <Notice tone="danger">{add.error}</Notice> : null}
    </Dialog>
  );
}
