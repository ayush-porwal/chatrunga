import type { TelemetryUnavailableReason } from "@chaturanga/shared/types/telemetry";

/** Where events go: a PostHog project's public ingest token and its region's ingest host. */
export type TelemetryProject = { token: string; host: string };

export type TelemetryConfig =
  /** `development`: a dev/test run that opted in; its events say `release_channel: "development"`. */
  | { available: true; reason: null; project: TelemetryProject; development?: boolean }
  | { available: false; reason: TelemetryUnavailableReason; project: null };

type Environment = Record<string, string | undefined>;

/**
 * Whether this run may collect usage analytics at all (the user's choice comes on top).
 *
 * - `CHATURANGA_TELEMETRY_ENABLED=false` (or `0`) turns it off whatever else is set.
 * - The project comes from the build (`MAIN_VITE_POSTHOG_PROJECT_TOKEN`, `MAIN_VITE_POSTHOG_HOST`);
 *   without both, or with a host that isn't https, there is nothing to send to.
 * - Development, test and automation runs (unpackaged, Vitest, a throwaway profile) never deliver
 *   unless `CHATURANGA_TELEMETRY_DEV=1` asks for it, e.g. against a separate test project.
 */
export function resolveTelemetryConfig(input: {
  env: Environment;
  isPackaged: boolean;
  token: string | undefined;
  host: string | undefined;
}): TelemetryConfig {
  const { env } = input;
  const hardSwitch = env.CHATURANGA_TELEMETRY_ENABLED?.trim().toLowerCase();
  if (hardSwitch === "false" || hardSwitch === "0") return unavailable("disabled_by_environment");

  const project = parseProject(input.token, input.host);
  if (!project) return unavailable("not_configured");

  const automated = Boolean(env.VITEST || env.NODE_ENV === "test" || env.CHATURANGA_USER_DATA_DIR);
  const development = !input.isPackaged || automated;
  if (development && env.CHATURANGA_TELEMETRY_DEV !== "1") return unavailable("development");
  return { available: true, reason: null, project, ...(development ? { development: true } : {}) };
}

function unavailable(reason: TelemetryUnavailableReason): TelemetryConfig {
  return { available: false, reason, project: null };
}

/** A token and an https origin (the region's ingest host, e.g. `https://eu.i.posthog.com`). */
function parseProject(
  token: string | undefined,
  host: string | undefined
): TelemetryProject | null {
  const trimmedToken = token?.trim();
  if (!trimmedToken || !host?.trim()) return null;
  try {
    const url = new URL(host.trim());
    if (url.protocol !== "https:") return null;
    return { token: trimmedToken, host: url.origin };
  } catch {
    return null;
  }
}
