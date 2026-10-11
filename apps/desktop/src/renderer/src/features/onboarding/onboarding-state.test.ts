import { describe, expect, it } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { SetupRow } from "@/lib/engine-assets";
import {
  downloadFailureReason,
  downloadPercent,
  engineSetupPhase,
  engineSummary,
  enginesView,
  evaluationEngine,
  levelSummary,
  listedReadyEngine,
  nearestLevelPreset,
  progressRingDash,
  readyEngineRow,
  shouldShowOnboarding,
  stepOffset
} from "./onboarding-state";

describe("shouldShowOnboarding", () => {
  it("shows for a new install once saved settings have loaded", () => {
    expect(
      shouldShowOnboarding({ settingsLoaded: true, completedAt: null, legacyDismissed: false })
    ).toBe(true);
    // Defaults before the settings arrive must not flash the welcome for everyone.
    expect(
      shouldShowOnboarding({ settingsLoaded: false, completedAt: null, legacyDismissed: false })
    ).toBe(false);
  });

  it("stays closed after it was finished or skipped, and for installs that predate it", () => {
    expect(
      shouldShowOnboarding({
        settingsLoaded: true,
        completedAt: 1_700_000_000_000,
        legacyDismissed: false
      })
    ).toBe(false);
    expect(
      shouldShowOnboarding({ settingsLoaded: true, completedAt: 0, legacyDismissed: false })
    ).toBe(false);
  });

  it("stays closed for someone who dismissed the earlier welcome dialog", () => {
    expect(
      shouldShowOnboarding({ settingsLoaded: true, completedAt: null, legacyDismissed: true })
    ).toBe(false);
  });
});

describe("steps", () => {
  it("moves forward and back within the flow", () => {
    expect(stepOffset("welcome", 1)).toBe("engines");
    expect(stepOffset("engines", -1)).toBe("welcome");
    expect(stepOffset("welcome", -1)).toBe("welcome");
    expect(stepOffset("done", 1)).toBe("done");
  });
});

const engine = (patch: Partial<EngineConfig>): EngineConfig => ({
  id: "e",
  name: "Engine",
  executablePath: "/x",
  workingDirectory: null,
  weightsPath: null,
  imagePath: null,
  args: [],
  protocol: "uci",
  runtime: "custom-uci",
  isAvailable: true,
  isDefault: false,
  createdAt: 0,
  updatedAt: 0,
  ...patch
});

describe("evaluationEngine", () => {
  it("needs an available engine that is not a Maia (human prediction) network", () => {
    expect(evaluationEngine(undefined)).toBeNull();
    expect(evaluationEngine([engine({ id: "maia", isHumanPrediction: true })])).toBeNull();
    expect(evaluationEngine([engine({ id: "sf", isAvailable: false })])).toBeNull();
    expect(
      evaluationEngine([engine({ id: "maia", isHumanPrediction: true }), engine({ id: "sf" })])?.id
    ).toBe("sf");
  });
});

const row = (status: SetupRow["status"]): SetupRow => ({
  key: "stockfish",
  label: "Stockfish",
  ids: ["stockfish"],
  bytesReceived: 0,
  bytesTotal: 1,
  status
});

describe("engineSetupPhase", () => {
  it("reports downloads first, then failures, then readiness", () => {
    expect(
      engineSetupPhase({
        statusLoaded: true,
        engineReady: false,
        running: true,
        rows: [row("downloading")]
      })
    ).toBe("downloading");
    expect(
      engineSetupPhase({
        statusLoaded: true,
        engineReady: false,
        running: false,
        rows: [row("error")]
      })
    ).toBe("failed");
    expect(
      engineSetupPhase({ statusLoaded: true, engineReady: true, running: false, rows: [] })
    ).toBe("ready");
    expect(
      engineSetupPhase({ statusLoaded: false, engineReady: false, running: false, rows: [] })
    ).toBe("checking");
    expect(
      engineSetupPhase({ statusLoaded: true, engineReady: false, running: false, rows: [] })
    ).toBe("missing");
  });
});

describe("level", () => {
  it("highlights the nearest preset", () => {
    expect(nearestLevelPreset(1450).rating).toBe(1500);
    expect(nearestLevelPreset(100).rating).toBe(800);
  });

  it.each([
    [1500, "white", "1500 · Club · White"],
    [2100, "black", "2100 · Expert · Black"],
    [1450, "white", "1450 · White"]
  ] as const)("sums up %i for %s as %s", (rating, side, text) => {
    expect(levelSummary(rating, side)).toBe(text);
  });
});

describe("downloadFailureReason", () => {
  it.each([
    ["GitHub API unreachable: fetch failed", "No connection"],
    ["getaddrinfo ENOTFOUND github.com", "No connection"],
    ["GitHub API rate limit exceeded (resets 2026-10-11T12:00:00.000Z)", "Busy, try later"],
    ["ENOSPC: no space left on device, write", "Disk is full"],
    ["sha256 mismatch for stockfish", "Download damaged"],
    ["download incomplete: 10 of 20 bytes", "Download damaged"],
    ["EPERM: operation not permitted, rename", "Couldn’t install"],
    ["download failed: 404 Not Found", "Didn’t download"]
  ])("reads %j as %j", (message, reason) => {
    expect(downloadFailureReason(message)).toBe(reason);
  });

  it("says the download failed when there is no message", () => {
    expect(downloadFailureReason(undefined)).toBe("Didn’t download");
  });
});

const setupRow = (key: SetupRow["key"], patch: Partial<SetupRow> = {}): SetupRow => ({
  key,
  label: key,
  ids: [],
  bytesReceived: 0,
  bytesTotal: 100,
  status: "pending",
  ...patch
});

describe("downloadPercent", () => {
  it("adds up every row's bytes", () => {
    expect(
      downloadPercent([
        setupRow("stockfish", { bytesReceived: 60, bytesTotal: 80 }),
        setupRow("maia", { bytesReceived: 4, bytesTotal: 20 })
      ])
    ).toBe(64);
  });

  it("is 0 before any size is known", () => {
    expect(downloadPercent([setupRow("stockfish", { bytesTotal: 0 })])).toBe(0);
  });
});

describe("the ready engine row", () => {
  it("names the app's Stockfish by what it does", () => {
    expect(readyEngineRow(engine({ name: "Stockfish (managed)" }))).toStrictEqual({
      name: "Stockfish",
      detail: "Best moves"
    });
  });

  it("names the user's own engine by its path", () => {
    expect(
      readyEngineRow(engine({ name: "My engine", executablePath: "/opt/homebrew/bin/stockfish" }))
    ).toStrictEqual({ name: "My engine", detail: "/opt/homebrew/bin/stockfish" });
  });

  it("is listed when the setup list has no Stockfish row", () => {
    expect(listedReadyEngine([setupRow("maia")], engine({}))?.id).toBe("e");
  });

  it("is left out when the list has its own Stockfish row", () => {
    expect(listedReadyEngine([setupRow("stockfish")], engine({}))).toBeNull();
  });
});

describe("progressRingDash", () => {
  const circumference = 2 * Math.PI * 16;

  it("leaves the whole circle to go at 0%", () => {
    expect(progressRingDash(0, 16)).toStrictEqual({ circumference, offset: circumference });
  });

  it("draws the part done", () => {
    expect(progressRingDash(25, 16).offset).toBeCloseTo(circumference * 0.75);
  });

  it("clamps outside 0–100", () => {
    expect(progressRingDash(140, 16).offset).toBe(0);
  });
});

describe("enginesView", () => {
  const base = { statusLoaded: true, statusFailed: false, rows: [], engine: null };

  it("shows placeholders until the status loads", () => {
    expect(enginesView({ ...base, statusLoaded: false })).toBe("checking");
  });

  it("shows the failed check when nothing else can be listed", () => {
    expect(enginesView({ ...base, statusFailed: true })).toBe("check-failed");
  });

  it("lists an engine that already works, even when the check failed", () => {
    expect(enginesView({ ...base, statusFailed: true, engine: engine({}) })).toBe("list");
  });

  it("lists the rows", () => {
    expect(enginesView({ ...base, rows: [setupRow("stockfish")] })).toBe("list");
  });

  it("says there is nothing to download here", () => {
    expect(enginesView(base)).toBe("none");
  });
});

describe("engineSummary", () => {
  const base = {
    phase: "missing" as const,
    rows: [] as SetupRow[],
    engine: null,
    statusFailed: false,
    offer: false
  };

  it("shows the whole download's progress while it runs", () => {
    expect(
      engineSummary({
        ...base,
        phase: "downloading",
        rows: [setupRow("stockfish", { bytesReceived: 50, status: "downloading" })]
      })
    ).toStrictEqual({ tone: "busy", text: "Downloading", percent: 50 });
  });

  it("offers Retry for a failed download", () => {
    const failed = setupRow("stockfish", { status: "error" });
    expect(engineSummary({ ...base, phase: "failed", rows: [failed] })).toStrictEqual({
      tone: "failed",
      text: "Stockfish didn’t download",
      retry: failed
    });
  });

  it("names the engines that are ready", () => {
    expect(
      engineSummary({
        ...base,
        phase: "ready",
        rows: [setupRow("stockfish", { status: "ready" }), setupRow("maia", { status: "ready" })]
      })
    ).toStrictEqual({ tone: "done", text: "Stockfish and Maia" });
  });

  it("names the user's own engine when it is the one ready", () => {
    expect(
      engineSummary({ ...base, phase: "ready", engine: engine({ name: "My engine" }) })
    ).toStrictEqual({ tone: "done", text: "My engine" });
  });

  it("offers Try again when the check failed", () => {
    expect(engineSummary({ ...base, statusFailed: true })).toStrictEqual({
      tone: "failed",
      text: "Couldn’t check",
      recheck: true
    });
  });

  it("offers the download when it was skipped", () => {
    expect(engineSummary({ ...base, offer: true })).toStrictEqual({
      tone: "skipped",
      text: "Skipped",
      download: true
    });
  });
});
