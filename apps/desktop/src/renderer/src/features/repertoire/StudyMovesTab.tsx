import type { ReactNode } from "react";
import { stripBookPage } from "@chaturanga/shared/books/book-page";
import type { ChapterLookup } from "@chaturanga/shared/chess/repertoire-index";
import type { Color, MoveNode } from "@chaturanga/shared/types/chess";
import {
  REPERTOIRE_ROOT_NODE_ID,
  type RepertoireChapter
} from "@chaturanga/shared/types/repertoire";
import { useStudyEngineStore } from "../../stores/study-engine-store";
import type { BookPageLinks } from "../game/TreeView";
import type { MoveKind } from "./repertoire-model";
import { StudyEnginePanel } from "./StudyEnginePanel";
import { StudyTree } from "./StudyTree";

/**
 * The Moves tab: the engine (while Analyze is on) at the top, as Analysis's, then the choices
 * panel, the starting position's row and the tree with its comments (staged moves in the warn
 * tone, flagged ones with a warning), the selected move carrying its menu (`menu`; a right-click
 * on a move opens it too).
 */
export function StudyMovesTab({
  chapter,
  lookup,
  node,
  orientation,
  kinds,
  staged,
  moveFlags,
  choices,
  engineOpen,
  menu,
  bookPages,
  onSelectNode,
  onOpenMenu,
  onOpenEngineSettings
}: {
  chapter: RepertoireChapter;
  lookup: ChapterLookup;
  node: MoveNode;
  orientation: Color;
  kinds: ReadonlyMap<string, MoveKind>;
  staged: ReadonlySet<string>;
  /** The health check's flags on the tree's moves (node id → what the flag says). */
  moveFlags: ReadonlyMap<string, string>;
  choices: ReactNode;
  engineOpen: boolean;
  menu: ReactNode;
  /** The book page chips (a repertoire imported from a book). */
  bookPages?: BookPageLinks;
  onSelectNode: (nodeId: string) => void;
  onOpenMenu: () => void;
  onOpenEngineSettings?: () => void;
}) {
  const atRoot = node.id === REPERTOIRE_ROOT_NODE_ID;
  return (
    <div className="flex h-full min-h-0 flex-col">
      {engineOpen ? (
        <StudyEnginePanel
          chapter={chapter}
          node={node}
          orientation={orientation}
          onClose={() => useStudyEngineStore.getState().close()}
          onOpenSettings={onOpenEngineSettings}
        />
      ) : null}
      {choices}
      <StartRow
        selected={atRoot}
        comment={stripBookPage(lookup.nodesById.get(REPERTOIRE_ROOT_NODE_ID)?.comment)}
        menu={atRoot ? menu : null}
        onSelect={() => onSelectNode(REPERTOIRE_ROOT_NODE_ID)}
        onContextMenu={() => {
          onSelectNode(REPERTOIRE_ROOT_NODE_ID);
          onOpenMenu();
        }}
      />
      <StudyTree
        key={chapter.id}
        className="flex-1 px-3 pb-3"
        lookup={lookup}
        kinds={kinds}
        staged={staged}
        moveFlags={moveFlags}
        selectedNodeId={node.id}
        onSelectNode={onSelectNode}
        showComments
        bookPages={bookPages}
        selectedActions={atRoot ? undefined : menu}
        onMoveContextMenu={onOpenMenu}
        emptyLabel="No moves yet — play the first move on the board."
        ariaLabel="Chapter moves"
      />
    </div>
  );
}

/**
 * The tree's first row: the chapter's starting position (selectable, with its menu while selected
 * and its comment under it), as the moves after it are.
 */
function StartRow({
  selected,
  comment,
  menu,
  onSelect,
  onContextMenu
}: {
  selected: boolean;
  comment: string | null;
  menu: ReactNode;
  onSelect: () => void;
  onContextMenu: () => void;
}) {
  return (
    <div className="shrink-0 px-3 pt-2">
      <div
        className={
          selected
            ? "relative flex h-8 items-center rounded-[0.3125rem] bg-accent-soft"
            : "relative flex h-8 items-center rounded-[0.3125rem] hover:bg-control"
        }
      >
        <button
          type="button"
          aria-current={selected ? "step" : undefined}
          className={
            selected
              ? "flex h-8 flex-1 items-center rounded-[0.3125rem] px-2 text-left text-xs font-semibold text-fg outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
              : "flex h-8 flex-1 items-center rounded-[0.3125rem] px-2 text-left text-xs text-fg-muted outline-none focus-visible:ring-2 focus-visible:ring-accent/50"
          }
          onClick={onSelect}
          onContextMenu={(event) => {
            event.preventDefault();
            onContextMenu();
          }}
        >
          Starting position
        </button>
        {menu ? <span className="absolute right-0.5 flex">{menu}</span> : null}
      </div>
      {comment ? (
        <p className="px-2 pt-1 text-xs leading-relaxed whitespace-pre-line text-fg-muted">
          {comment}
        </p>
      ) : null}
    </div>
  );
}
