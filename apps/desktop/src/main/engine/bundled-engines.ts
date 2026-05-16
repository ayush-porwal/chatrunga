import { app } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { stockfishEngine } from "@chaturanga/shared/engine/bundled";
import type { EngineConfig } from "@chaturanga/shared/types/engine";

function stockfishBinaryName(): string {
  return process.platform === "win32" ? "stockfish.exe" : "stockfish";
}

export function bundledEngineRoot(): string {
  return app.isPackaged
    ? join(process.resourcesPath, "engines")
    : join(app.getAppPath(), "src/main/assets/engines");
}

export function bundledStockfishPath(): string {
  return join(
    bundledEngineRoot(),
    "stockfish",
    `${process.platform}-${process.arch}`,
    stockfishBinaryName()
  );
}

export function listBundledEngines(): EngineConfig[] {
  const executablePath = bundledStockfishPath();
  return [
    stockfishEngine({
      executablePath,
      isAvailable: existsSync(executablePath),
      runtime: "native-bundled"
    })
  ];
}
