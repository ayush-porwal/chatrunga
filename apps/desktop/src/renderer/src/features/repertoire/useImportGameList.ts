import { useRef, useState } from "react";
import type { ImportPreview, ImportSelection } from "@chaturanga/shared/types/repertoire";
import { filterGames, PREVIEW_PAGE_SIZE } from "./long-lists";

/** The default selection of each previewed game: included, its proposed title, opening kind. */
function defaultSelections(preview: ImportPreview): ImportSelection[] {
  return preview.games.map((game) => ({
    gameIndex: game.index,
    title: game.proposedTitle,
    kind: "opening",
    include: game.nodeCount > 0,
    excludeNodeIds: []
  }));
}

/** The previewed games: what is chosen for each, the search over them and the page shown. */
export function useImportGameList() {
  const [selections, setSelections] = useState<ImportSelection[]>([]);
  /** The preview's search, and the games it found (every game when it's blank). */
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<number[]>([]);
  /** Rows of `found` rendered; "Show more" adds a page. */
  const [shownCount, setShownCount] = useState(PREVIEW_PAGE_SIZE);
  const listRef = useRef<HTMLUListElement | null>(null);

  /** A new preview: every game listed with its default selection, from the first page. */
  const reset = (preview: ImportPreview) => {
    setSelections(defaultSelections(preview));
    setQuery("");
    setFound(preview.games.map((_game, index) => index));
    setShownCount(PREVIEW_PAGE_SIZE);
  };

  const update = (index: number, patch: Partial<ImportSelection>) =>
    setSelections((current) =>
      current.map((item, position) => (position === index ? { ...item, ...patch } : item))
    );

  /**
   * Searches the games by title or number. The result is taken when the search changes, so
   * renaming a found game never hides the row being typed in.
   */
  const search = (games: ImportPreview["games"], text: string) => {
    setQuery(text);
    setFound(filterGames(games, selections, text));
    setShownCount(PREVIEW_PAGE_SIZE);
  };

  /** Shows the next page of games and moves focus to the first one it adds. */
  const showMore = () => {
    const first = found[shownCount];
    setShownCount((count) => count + PREVIEW_PAGE_SIZE);
    requestAnimationFrame(() =>
      listRef.current
        ?.querySelector<HTMLInputElement>(`[data-game-index="${first}"] input[type="checkbox"]`)
        ?.focus()
    );
  };

  return {
    selections,
    setSelections,
    query,
    searching: Boolean(query.trim()),
    found,
    shownCount,
    shown: found.slice(0, shownCount),
    included: selections.filter((selection) => selection.include).length,
    listRef,
    reset,
    update,
    search,
    showMore
  };
}

export type ImportGameList = ReturnType<typeof useImportGameList>;
