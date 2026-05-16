import type { EngineConfig } from "../types/engine";

export const BUNDLED_STOCKFISH_ID = "bundled-stockfish";

type StockfishInput = {
  executablePath?: string;
  isAvailable?: boolean;
  runtime: EngineConfig["runtime"];
};

export function stockfishEngine(input: StockfishInput): EngineConfig {
  const now = 0;
  return {
    id: BUNDLED_STOCKFISH_ID,
    name: "Stockfish",
    executablePath: input.executablePath ?? "",
    workingDirectory: null,
    weightsPath: null,
    imagePath: null,
    args: [],
    protocol: "uci",
    runtime: input.runtime,
    isBundled: true,
    isAvailable: input.isAvailable ?? true,
    isDefault: true,
    createdAt: now,
    updatedAt: now
  };
}

export function stockfishWasmEngine(): EngineConfig {
  return stockfishEngine({ runtime: "wasm", isAvailable: true });
}
