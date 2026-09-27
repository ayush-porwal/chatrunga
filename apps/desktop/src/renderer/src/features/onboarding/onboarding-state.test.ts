import { describe, expect, it } from "vitest";
import type { EngineConfig } from "@chaturanga/shared/types/engine";
import type { SetupRow } from "@/lib/engine-assets";
import {
  ONBOARDING_STEPS,
  clampRating,
  engineSetupPhase,
  evaluationEngine,
  nearestLevelPreset,
  shouldShowOnboarding,
  stepOffset
} from "./onboarding-state";
import { operaGameMainline, operaGameMoment } from "./opera-game";

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
    expect(ONBOARDING_STEPS[0]).toBe("welcome");
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
  it("highlights the nearest preset and clamps typed ratings", () => {
    expect(nearestLevelPreset(1450).rating).toBe(1500);
    expect(nearestLevelPreset(100).rating).toBe(800);
    expect(clampRating(90)).toBe(400);
    expect(clampRating(4000)).toBe(3500);
    expect(clampRating(Number.NaN)).toBe(1500);
    expect(clampRating(1234.6)).toBe(1235);
  });
});

describe("Opera game illustration", () => {
  it("parses the Opera game: 33 plies ending in mate", () => {
    const nodes = operaGameMainline();
    expect(nodes).toHaveLength(34);
    expect(nodes[33].san).toBe("Rd8#");
    expect(operaGameMoment(31).label).toBe("16.Qb8+");
    expect(operaGameMoment(30).label).toBe("15…Nxd7");
    expect(operaGameMoment(0).label).toBe("Start");
  });
});
