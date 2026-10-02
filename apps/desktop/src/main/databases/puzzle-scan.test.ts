import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { scanCsvLines } from "./puzzle-scan";

describe("scanCsvLines", () => {
  it.each([true, false])("fails instead of hanging when the file can't be read (compressed: %s)", async (compressed) => {
    // A directory opens but every read fails (EISDIR).
    const directory = mkdtempSync(join(tmpdir(), "chaturanga-scan-"));
    await expect(scanCsvLines(directory, compressed, () => undefined)).rejects.toThrow();
  });
});
