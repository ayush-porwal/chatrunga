import { GitBranch } from "lucide-react";
import type { AddFromGamePreview } from "@chaturanga/shared/types/repertoire";
import { Notice } from "@/components/ui/notice";
import { Switch } from "@/components/ui/switch";
import { ipcErrorMessage } from "@/lib/ipc-error";
import { fieldHint, fieldLabel, well } from "@/lib/ui";
import { cn } from "@/lib/utils";
import { conflictText } from "./add-from-game";
import { plural } from "./repertoire-chapters";
import type { AddPreview, DestinationKind } from "./useAddToRepertoireForm";

/**
 * What the add changes: the own moves to learn (ticked by the proposed policy), whether opponent
 * replies are covered, a summary, where it differs from the repertoire, and the preview's warnings.
 */
export function AddPreviewSection({
  preview,
  destinationKind
}: {
  preview: AddPreview;
  destinationKind: DestinationKind;
}) {
  const { query, fresh, shown, policyState, dispatch } = preview;
  return (
    <section
      aria-label="What this adds"
      aria-busy={!fresh || undefined}
      className={cn("grid gap-3 transition-opacity", !fresh && shown && "opacity-60")}
    >
      {/* A preview the main process refuses (a merge into a chapter with another start, a
          game gone from the library) is shown as is; Add stays off until one succeeds. */}
      {query.isError ? (
        <Notice tone="danger">
          {ipcErrorMessage(query.error) || "The preview couldn't be made."}
        </Notice>
      ) : !shown ? (
        <p className={fieldHint} role="status">
          Working out what this adds…
        </p>
      ) : (
        <>
          <OwnMovesChecklist
            moves={shown.ownMoves}
            included={policyState.included}
            disabled={!preview.policyReady}
            onToggle={(nodeId) => dispatch({ type: "toggle", nodeId })}
          />
          <label className="flex items-center justify-between gap-3 text-sm text-fg-secondary">
            <span>Cover opponent replies</span>
            <Switch
              checked={policyState.coverReplies}
              onCheckedChange={(on) => dispatch({ type: "set-cover", on })}
              aria-label="Cover opponent replies"
            />
          </label>
          <AddSummary shown={shown} destinationKind={destinationKind} />
          <AddDifferences conflicts={shown.conflicts} />
          <AddWarnings warnings={shown.warnings} />
        </>
      )}
    </section>
  );
}

/** The own moves the add can teach; unticked ones are kept as reference only. */
function OwnMovesChecklist({
  moves,
  included,
  disabled,
  onToggle
}: {
  moves: AddFromGamePreview["ownMoves"];
  included: readonly string[];
  disabled: boolean;
  onToggle: (nodeId: string) => void;
}) {
  if (!moves.length) return null;
  const ticked = new Set(included);
  return (
    <div className="grid gap-1.5">
      <p className={fieldLabel}>Your moves to learn</p>
      <ul
        className={cn(well, "scroll-area grid max-h-48 gap-0.5 overflow-y-auto p-1.5")}
        aria-label="Your moves to learn"
      >
        {moves.map((move) => (
          <li key={move.nodeId}>
            <label className="flex min-h-7 items-center gap-2 rounded-md px-1.5 text-sm text-fg-secondary hover:bg-control">
              <input
                type="checkbox"
                className="size-4 accent-accent"
                checked={ticked.has(move.nodeId)}
                disabled={disabled}
                onChange={() => onToggle(move.nodeId)}
              />
              <span className="min-w-0 truncate font-mono text-xs" title={move.path}>
                {move.path || move.san}
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className={fieldHint}>
        Unticked moves are kept as reference only; they are never asked in practice.
      </p>
    </div>
  );
}

function AddSummary({
  shown,
  destinationKind
}: {
  shown: AddFromGamePreview;
  destinationKind: DestinationKind;
}) {
  return (
    <ul className="grid gap-0.5 text-sm text-fg-secondary" aria-label="Summary">
      <li>
        Adds {plural(shown.decisionsAdded, "decision")} · {plural(shown.nodeCount, "move")} copied
      </li>
      {shown.transpositions ? (
        <li>{plural(shown.transpositions, "position")} already in this repertoire</li>
      ) : null}
      {destinationKind === "existing-chapter" && shown.alreadyPresent ? (
        <li>
          {plural(shown.alreadyPresent, "move")} already in this chapter (kept, not duplicated)
        </li>
      ) : null}
    </ul>
  );
}

/** Positions the repertoire already decides where the game plays another move. */
function AddDifferences({ conflicts }: { conflicts: AddFromGamePreview["conflicts"] }) {
  if (!conflicts.length) return null;
  return (
    <div className="grid gap-1.5">
      <p className={fieldLabel}>Different from your repertoire</p>
      <ul className="grid gap-1" aria-label="Differences">
        {conflicts.map((conflict) => (
          <li
            key={`${conflict.positionKey}:${conflict.newUci}`}
            className="flex items-start gap-2 text-xs text-fg-secondary"
          >
            <GitBranch className="mt-0.5 size-3.5 shrink-0 text-warn" aria-hidden="true" />
            <span>{conflictText(conflict)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AddWarnings({ warnings }: { warnings: readonly string[] }) {
  if (!warnings.length) return null;
  return (
    <Notice tone="warn">
      {warnings.length === 1 ? (
        warnings[0]
      ) : (
        <ul className="grid gap-0.5">
          {warnings.map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}
