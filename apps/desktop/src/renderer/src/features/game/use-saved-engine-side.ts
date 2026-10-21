import { useMemo } from "react";
import type { GameHeaders } from "@chaturanga/shared/types/chess";
import { savedEngineSide } from "../../app/rejoin-saved-game";
import { useEnginesQuery } from "../../queries/api";

/**
 * A saved engine game's engine side and its picture (see savedEngineSide), against the engines
 * installed now; null for any other game. Kept while the players and engines stay the same.
 */
export function useSavedEngineSide({
  white,
  black,
  engineId
}: Pick<GameHeaders, "white" | "black" | "engineId">) {
  const engines = useEnginesQuery().data;
  return useMemo(
    () => savedEngineSide({ white, black, engineId }, engines ?? []),
    [white, black, engineId, engines]
  );
}
