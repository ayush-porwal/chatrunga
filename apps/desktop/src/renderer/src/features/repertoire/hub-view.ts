/**
 * What the repertoire hub shows. A card holds a table, so it appears only when there is something
 * to list or to filter: with no repertoire at all (none active, none archived, no book being
 * imported) the page shows its empty state on its own, no card around it. A search or the archived view with no matches keeps
 * the card (its title bar holds the search and the archived toggle) with a quiet row.
 */
export type HubView = "loading" | "card" | "none";

export function hubView({
  desktop,
  filtered,
  listed,
  importing,
  archivedCount
}: {
  /** Repertoires need the desktop app; the browser build has none. */
  desktop: boolean;
  /** A search, or the archived view instead of the active one. */
  filtered: boolean;
  /** Rows of the current list (undefined while it loads or failed). */
  listed: number | undefined;
  /** Books being imported (listed as rows above the repertoires). */
  importing: number;
  /** Archived repertoires, asked only when the unfiltered list is empty (undefined until known). */
  archivedCount: number | undefined;
}): HubView {
  if (!desktop) return "none";
  if (filtered || importing > 0 || listed === undefined || listed > 0) return "card";
  if (archivedCount === undefined) return "loading";
  return archivedCount > 0 ? "card" : "none";
}
