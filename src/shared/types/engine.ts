import type { Color } from "./chess";

export type EngineProtocol = "uci";
export type EngineStatus = "idle" | "starting" | "ready" | "thinking" | "error";

export type EngineConfig = {
  id: string;
  name: string;
  executablePath: string;
  workingDirectory: string | null;
  args: string[];
  protocol: EngineProtocol;
  isDefault: boolean;
  isEnabled: boolean;
  createdAt: number;
  updatedAt: number;
};

export type CreateEngineInput = {
  name: string;
  executablePath: string;
  workingDirectory?: string | null;
  args?: string[];
  isDefault?: boolean;
  isEnabled?: boolean;
};

export type UpdateEngineInput = Partial<CreateEngineInput>;

export type EngineTestResult = {
  ok: boolean;
  name?: string;
  author?: string;
  error?: string;
};

export type StartEngineGameInput = {
  engineId: string;
  side: Color;
  fen: string;
  moves: string[];
  moveTimeMs?: number | null;
  depth?: number | null;
};

export type EngineScore = {
  type: "cp" | "mate";
  value: number;
};

export type EngineInfo = {
  engineId: string;
  depth?: number;
  seldepth?: number;
  nodes?: number;
  nps?: number;
  score?: EngineScore;
  pv?: string[];
  raw: string;
  receivedAt: number;
};

export type EngineBestMove = {
  engineId: string;
  move: string;
  ponder?: string;
};

export type EngineError = {
  engineId?: string;
  message: string;
};
