/** Repertoire columns read back: JSON that may be unreadable, and enums stored as text. */
import type { ChapterKind, RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type { ChapterOpening } from "@chaturanga/shared/types/repertoire-practice";
import { parseStoredJson } from "../stored-json";

/** Parses a JSON column, returning `fallback` when it is unreadable (non-critical columns). */
export function parseJson<T>(text: string | null, fallback: T): T {
  if (text === null) return fallback;
  try {
    return parseStoredJson<T>(text);
  } catch {
    return fallback;
  }
}

export function stringArray(text: string): string[] {
  const parsed = parseJson<unknown>(text, []);
  return Array.isArray(parsed)
    ? parsed.filter((item): item is string => typeof item === "string")
    : [];
}

export function stringRecord(text: string | null): Record<string, string> {
  const parsed = parseJson<unknown>(text, {});
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  return Object.fromEntries(
    Object.entries(parsed).filter(
      (entry): entry is [string, string] => typeof entry[1] === "string"
    )
  );
}

export const asColor = (value: string): RepertoireColor => (value === "black" ? "black" : "white");
export const asKind = (value: string): ChapterKind =>
  value === "reference" ? "reference" : "opening";

/** A chapter's opening columns: null when none was found; a typed one may be empty (cleared). */
export function chapterOpening(
  name: string | null,
  eco: string | null,
  edited: number
): ChapterOpening | null {
  if (!name && edited !== 1) return null;
  return { name: name ?? "", eco, edited: edited === 1 };
}
