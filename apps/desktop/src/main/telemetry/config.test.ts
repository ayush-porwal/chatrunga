import { describe, expect, it } from "vitest";
import { resolveTelemetryConfig } from "./config";

const project = { token: "phc_test", host: "https://eu.i.posthog.com" };

describe("resolveTelemetryConfig", () => {
  it("delivers only from a packaged, configured build outside automation", () => {
    expect(resolveTelemetryConfig({ env: {}, isPackaged: true, ...project })).toEqual({
      available: true,
      reason: null,
      project: { token: "phc_test", host: "https://eu.i.posthog.com" }
    });
  });

  it("CHATURANGA_TELEMETRY_ENABLED=false wins over everything", () => {
    for (const value of ["false", "0", " FALSE "]) {
      const config = resolveTelemetryConfig({
        env: { CHATURANGA_TELEMETRY_ENABLED: value, CHATURANGA_TELEMETRY_DEV: "1" },
        isPackaged: true,
        ...project
      });
      expect(config).toMatchObject({ available: false, reason: "disabled_by_environment" });
    }
  });

  it("never delivers from development, tests or automation unless explicitly asked", () => {
    expect(resolveTelemetryConfig({ env: {}, isPackaged: false, ...project }).reason).toBe(
      "development"
    );
    expect(
      resolveTelemetryConfig({ env: { VITEST: "true" }, isPackaged: true, ...project }).reason
    ).toBe("development");
    expect(
      resolveTelemetryConfig({ env: { NODE_ENV: "test" }, isPackaged: true, ...project }).reason
    ).toBe("development");
    expect(
      resolveTelemetryConfig({
        env: { CHATURANGA_USER_DATA_DIR: "/tmp/p" },
        isPackaged: true,
        ...project
      }).reason
    ).toBe("development");
    // This very test run: Vitest sets VITEST.
    expect(
      resolveTelemetryConfig({ env: process.env, isPackaged: true, ...project }).available
    ).toBe(false);
    // An explicit opt-in (e.g. against a test project) is marked as development.
    expect(
      resolveTelemetryConfig({
        env: { CHATURANGA_TELEMETRY_DEV: "1" },
        isPackaged: false,
        ...project
      })
    ).toMatchObject({
      available: true,
      development: true
    });
  });

  it("needs a token and an https host; no region is assumed", () => {
    expect(
      resolveTelemetryConfig({ env: {}, isPackaged: true, token: undefined, host: project.host })
        .reason
    ).toBe("not_configured");
    expect(
      resolveTelemetryConfig({ env: {}, isPackaged: true, token: "phc_test", host: undefined })
        .reason
    ).toBe("not_configured");
    expect(
      resolveTelemetryConfig({
        env: {},
        isPackaged: true,
        token: "phc_test",
        host: "http://eu.i.posthog.com"
      }).reason
    ).toBe("not_configured");
    expect(
      resolveTelemetryConfig({ env: {}, isPackaged: true, token: "phc_test", host: "not a url" })
        .reason
    ).toBe("not_configured");
    expect(
      resolveTelemetryConfig({
        env: {},
        isPackaged: true,
        token: " phc_test ",
        host: "https://us.i.posthog.com/some/path"
      }).project
    ).toEqual({ token: "phc_test", host: "https://us.i.posthog.com" });
  });
});
