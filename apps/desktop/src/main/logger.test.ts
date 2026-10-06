import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const logs = mkdtempSync(join(tmpdir(), "chaturanga-logger-"));
vi.mock("electron", () => ({ app: { getPath: () => logs } }));

const { logger } = await import("./logger");

describe("logger", () => {
  beforeAll(() => vi.spyOn(console, "log").mockImplementation(() => {}));
  afterAll(() => {
    vi.restoreAllMocks();
    rmSync(logs, { recursive: true, force: true });
  });

  it("keeps info lines in main.log, timestamped, but not the trace", () => {
    logger.info("main", "quit requested");
    logger.trace("uci:Fake", "→", "go infinite");
    const log = readFileSync(join(logs, "main.log"), "utf8");
    expect(log).toMatch(/^\d{4}-\d\d-\d\dT[\d:.]+Z INFO \[main\] quit requested\n$/);
  });

  it("rotates main.log once a session has written past 1 MB", () => {
    const line = "x".repeat(1_000);
    for (let index = 0; index < 1_100; index++) logger.info("main", line);
    expect(existsSync(join(logs, "main.old.log"))).toBe(true);
    expect(statSync(join(logs, "main.log")).size).toBeLessThan(1_000_000);
  });
});
