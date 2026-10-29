import { useMemo, useState } from "react";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireChapterSummary,
  RepertoireColor
} from "@chaturanga/shared/types/repertoire";
import { useRepertoireWorkspaceStore } from "../../stores/repertoire-workspace-store";
import type { StudyFromGames } from "./study-from-games";
import { StudyFromGamesBanner } from "./StudyFromGamesBanner";
import { StudyNewMovesCard } from "./StudyNewMovesCard";

const workspace = () => useRepertoireWorkspaceStore.getState();

/**
 * The notices atop Study's panel that the overhaul adds: the From your games banner (until
 * dismissed) and the New moves card, while the staged moves apply to the selected line (it is
 * staged, or leads to staged moves).
 */
export function StudyStagingNotices({
  repertoireId,
  fromGames,
  lookup,
  node,
  chapter,
  staged,
  color,
  chapters,
  busy,
  onPractisePosition,
  onAddElsewhere,
  onAddToNewChapter
}: {
  repertoireId: string;
  fromGames?: StudyFromGames | null;
  /** The shown chapter's lookup and the selected node. */
  lookup: ChapterLookup;
  node: MoveNode;
  /** The draft (without the staged moves). */
  chapter: RepertoireChapter;
  staged: readonly MoveNode[];
  color: RepertoireColor;
  chapters: readonly RepertoireChapterSummary[];
  busy: boolean;
  onPractisePosition?: (positionKey: string) => void;
  /** Hands the staged moves to another chapter and opens it. */
  onAddElsewhere: (chapterId: string) => void;
  /** Creates a chapter named `title` for the staged moves. */
  onAddToNewChapter: (title: string) => void;
}) {
  /** The banner dismissed (this payload's). */
  const [dismissed, setDismissed] = useState<StudyFromGames | null>(null);
  // The banner's position, for its move numbers: the first node reaching it.
  const fen = useMemo(() => {
    if (!fromGames) return null;
    const id = lookup.order.find((item) => lookup.positionKeys.get(item) === fromGames.positionKey);
    return id ? lookup.nodesById.get(id)!.fenAfter : null;
  }, [fromGames, lookup]);
  const stagedHere = staged.some((item) =>
    (lookup.parentPath.get(item.id) ?? []).includes(node.id)
  );
  return (
    <>
      {fromGames && fromGames !== dismissed ? (
        <StudyFromGamesBanner
          fromGames={fromGames}
          fen={fen}
          onPractise={onPractisePosition}
          onDismiss={() => setDismissed(fromGames)}
        />
      ) : null}
      {stagedHere ? (
        <StudyNewMovesCard
          repertoireId={repertoireId}
          chapter={chapter}
          staged={staged}
          color={color}
          chapters={chapters}
          busy={busy}
          onAdd={(studyOnly) => workspace().addStaged({ studyOnly })}
          onAddTo={onAddElsewhere}
          onAddToNewChapter={onAddToNewChapter}
          onDrop={(nodeId) => workspace().dropStaged(nodeId)}
          onDiscard={() => workspace().discardStaged()}
        />
      ) : null}
    </>
  );
}
