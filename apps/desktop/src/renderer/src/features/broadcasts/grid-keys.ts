import type { KeyboardEvent } from "react";

/**
 * Where an arrow key (or Home / End) moves in a grid of `count` cards laid out `columns` to a row,
 * from the card at `index`; null for another key, or a move off the grid's edge.
 */
export function gridStep(
  key: string,
  index: number,
  count: number,
  columns: number
): number | null {
  const next =
    key === "ArrowLeft"
      ? index - 1
      : key === "ArrowRight"
        ? index + 1
        : key === "ArrowUp"
          ? index - columns
          : key === "ArrowDown"
            ? index + columns
            : key === "Home"
              ? 0
              : key === "End"
                ? count - 1
                : null;
  return next === null || next < 0 || next >= count ? null : next;
}

/**
 * Moves the focus between the cards of the grid the event's card sits in (its siblings), with the
 * arrow keys, Home and End. The columns are counted from the cards on the first row.
 */
export function moveFocusInGrid(event: KeyboardEvent<HTMLElement>): void {
  const grid = event.currentTarget.parentElement;
  if (!grid) return;
  const cards = [...grid.children].filter((child) => child instanceof HTMLElement);
  const top = cards.at(0)?.offsetTop;
  const columns = cards.filter((card) => card.offsetTop === top).length;
  const next = gridStep(event.key, cards.indexOf(event.currentTarget), cards.length, columns);
  if (next === null) return;
  event.preventDefault();
  cards[next]?.focus();
}
