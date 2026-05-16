import { describe, expect, it } from "vitest";
import { engineAcceptsHumanDrawOffer } from "./draw-offer";

describe("engineAcceptsHumanDrawOffer", () => {
  it("declines without score", () => {
    expect(engineAcceptsHumanDrawOffer(null).accepted).toBe(false);
  });

  it("declines when human has mate", () => {
    expect(engineAcceptsHumanDrawOffer({ type: "mate", value: 3 }).accepted).toBe(false);
  });

  it("accepts when human is mated", () => {
    expect(engineAcceptsHumanDrawOffer({ type: "mate", value: -2 }).accepted).toBe(true);
  });

  it("uses centipawn thresholds", () => {
    expect(engineAcceptsHumanDrawOffer({ type: "cp", value: -100 }).accepted).toBe(false);
    expect(engineAcceptsHumanDrawOffer({ type: "cp", value: 100 }).accepted).toBe(true);
    expect(engineAcceptsHumanDrawOffer({ type: "cp", value: 0 }).accepted).toBe(true);
  });
});
