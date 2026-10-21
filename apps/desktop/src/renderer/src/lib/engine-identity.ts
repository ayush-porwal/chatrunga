import { engineDisplayName } from "@chaturanga/shared/engine/managed";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import lc0Logo from "../assets/engines/lc0.webp";
import maiaLogo from "../assets/engines/maia.webp";
import stockfishLogo from "../assets/engines/stockfish.webp";
import { localImageSrc } from "./local-image";

/**
 * What an engine's picture is worked out from: a saved engine, or just a name where that is all
 * there is (saved reviews, recent games, download rows, onboarding).
 */
export type EngineIdentity = Pick<EngineConfig, "name"> &
  Partial<Pick<EngineConfig, "imagePath" | "weightsPath" | "isHumanPrediction" | "maiaRating">>;

type EngineFamily = "stockfish" | "maia" | "lc0";

/** The bundled logos, resolved at render time (never stored: the hashed URLs change per build). */
const LOGOS: Record<EngineFamily, string> = {
  stockfish: stockfishLogo,
  maia: maiaLogo,
  lc0: lc0Logo
};

/**
 * The engine family with a bundled logo, if any. Maia first (it runs inside Lc0): the human
 * prediction flag, a Maia rating, or "maia" in the name or the weights file's name.
 */
function engineFamily(engine: EngineIdentity): EngineFamily | null {
  const weightsFile = engine.weightsPath?.split(/[\\/]/).pop() ?? "";
  if (
    engine.isHumanPrediction ||
    engine.maiaRating != null ||
    /maia/i.test(engine.name) ||
    /maia/i.test(weightsFile)
  ) {
    return "maia";
  }
  if (/stockfish/i.test(engine.name)) return "stockfish";
  if (/\blc0\b|leela/i.test(engine.name)) return "lc0";
  return null;
}

/**
 * Up to two letters for an engine without a picture: the first two words' initials
 * ("Komodo Dragon" → "KD"), or a single word's first two letters ("Berserk" → "Be"). Version
 * numbers ("14", "v9", "17.1") and punctuation are skipped; "" when nothing is left.
 */
function engineMonogram(name: string): string {
  const words = engineDisplayName(name)
    .split(/[\s_\-()[\]/.,]+/)
    .filter((word) => !/^v?\d/i.test(word))
    .map((word) => word.replace(/[^\p{L}]/gu, ""))
    .filter(Boolean);
  const [first = "", second] = words;
  if (second) return (first.charAt(0) + second.charAt(0)).toUpperCase();
  return first.charAt(0).toUpperCase() + first.charAt(1).toLowerCase();
}

/** A stable hue (0–359) for the monogram tile, from the shown name (FNV-1a). */
function engineMonogramHue(name: string): number {
  let hash = 0x811c9dc5;
  for (const char of engineDisplayName(name).toLowerCase()) {
    hash = Math.imul(hash ^ (char.codePointAt(0) ?? 0), 0x01000193);
  }
  return (hash >>> 0) % 360;
}

export type EnginePicture =
  | { kind: "image"; src: string }
  | { kind: "logo"; family: EngineFamily; src: string }
  | { kind: "monogram"; text: string; hue: number };

/**
 * An engine's picture: its own image (one the app can load, see localImageSrc), else its family's
 * bundled logo, else a monogram.
 */
export function enginePicture(engine: EngineIdentity): EnginePicture {
  const src = localImageSrc(engine.imagePath);
  return src ? { kind: "image", src } : fallbackPicture(engine);
}

/** The picture without the engine's own image (also what shows when that image fails to load). */
export function fallbackPicture(engine: EngineIdentity): Exclude<EnginePicture, { kind: "image" }> {
  const family = engineFamily(engine);
  if (family) return { kind: "logo", family, src: LOGOS[family] };
  return {
    kind: "monogram",
    text: engineMonogram(engine.name),
    hue: engineMonogramHue(engine.name)
  };
}
