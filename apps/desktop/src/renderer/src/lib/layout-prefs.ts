/**
 * Window layout choices remembered on this machine (localStorage): whether the sidebar is expanded
 * or an icon rail, and the edge the board was dragged to. They describe this screen's layout, not
 * the user's chess preferences, so they stay out of the app settings (a board size in pixels means
 * nothing on another display). A missing, unreadable or invalid value falls back to the default.
 */

const SIDEBAR_EXPANDED_KEY = "chaturanga.layout.sidebarExpanded";
const BOARD_EDGE_KEY = "chaturanga.layout.boardEdge";

/** Larger than any display's board; a stored edge beyond it is not one this app wrote. */
const MAX_STORED_BOARD_EDGE = 10_000;

function storage(): Storage | null {
  // Storage access throws where it is blocked (a sandboxed or opaque origin).
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function read(key: string): string | null {
  try {
    return storage()?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    const store = storage();
    if (value === null) store?.removeItem(key);
    else store?.setItem(key, value);
  } catch {
    // Full or blocked storage: the choice still applies for this session.
  }
}

/** The sidebar opens expanded unless it was last left as a rail. */
export function loadSidebarExpanded(): boolean {
  return read(SIDEBAR_EXPANDED_KEY) !== "0";
}

export function saveSidebarExpanded(expanded: boolean): void {
  write(SIDEBAR_EXPANDED_KEY, expanded ? "1" : "0");
}

/** The board edge (CSS px) the user resized the board to; null: the board fills its space. */
export function loadBoardEdge(): number | null {
  const raw = read(BOARD_EDGE_KEY);
  if (raw === null) return null;
  const edge = Number(raw);
  return Number.isFinite(edge) && edge > 0 && edge <= MAX_STORED_BOARD_EDGE ? edge : null;
}

export function saveBoardEdge(edge: number | null): void {
  write(BOARD_EDGE_KEY, edge === null ? null : String(Math.round(edge)));
}
