import {
  MAIA_PUZZLE_KINDS,
  type GamePuzzleGameCount,
  type GamePuzzleKind,
  type GamePuzzleSettings
} from "@chaturanga/shared/types/game-puzzles";

/** `list` with `item` added, or taken out when it was in (in the order of `order`). */
export function toggled<T>(list: readonly T[], item: T, order: readonly T[]): T[] {
  const next = list.includes(item) ? list.filter((value) => value !== item) : [...list, item];
  return order.filter((value) => next.includes(value));
}

/** What Start queues: without Maia 3, the kinds that need it are left out (they can't run). */
export function settingsToStart(
  settings: GamePuzzleSettings,
  maiaInstalled: boolean
): GamePuzzleSettings {
  if (maiaInstalled) return settings;
  return { ...settings, kinds: settings.kinds.filter((kind) => !MAIA_PUZZLE_KINDS.includes(kind)) };
}

/** Whether a kind can be chosen (the Maia kinds need Maia 3). */
export function kindAvailable(kind: GamePuzzleKind, maiaInstalled: boolean): boolean {
  return maiaInstalled || !MAIA_PUZZLE_KINDS.includes(kind);
}

/** Start needs a kind to look for and a game to look in. */
export function canStartGeneration(
  settings: GamePuzzleSettings,
  count: GamePuzzleGameCount | undefined
): boolean {
  return settings.kinds.length > 0 && (count?.eligible ?? 0) > 0;
}

/** "24 games match", and how many matching games aren't played by a connected account. */
export function gameCountText(count: GamePuzzleGameCount): string {
  const games = `${count.eligible.toLocaleString()} ${count.eligible === 1 ? "game matches" : "games match"}`;
  if (!count.withoutUserSide) return games;
  return `${games} · ${count.withoutUserSide.toLocaleString()} without a connected account are skipped`;
}

/** The How many choice as the segmented control holds it ("all": every matching game). */
export function limitChoice(limit: number | null): string {
  return limit === null ? "all" : String(limit);
}

export function limitFromChoice(choice: string): number | null {
  return choice === "all" ? null : Number(choice);
}
