import type { EngineIdentity } from "@/lib/engine-identity";

/** What a player's slot shows (see sideMark). */
export type SideMark<P> =
  | { kind: "engine"; engine: EngineIdentity }
  | { kind: "you"; picture: P }
  | { kind: "side" };

/**
 * What a player's slot shows, the first that applies: the engine's picture on the side an engine
 * played, your picture on your side (`yours`: given only for your side, while you have a picture
 * that loads), else the side's colour.
 */
export function sideMark<P>(
  engine: EngineIdentity | null | undefined,
  yours: P | null | undefined
): SideMark<P> {
  if (engine) return { kind: "engine", engine };
  if (yours) return { kind: "you", picture: yours };
  return { kind: "side" };
}
