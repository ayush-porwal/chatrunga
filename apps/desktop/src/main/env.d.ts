/**
 * Build-time values electron-vite exposes to the main process (`MAIN_VITE_*` from the environment
 * or an env file when building). All are public; see docs/telemetry.md.
 */
interface ImportMetaEnv {
  /** PostHog project token (ingest-only, `phc_…`). Unset: usage analytics can't be turned on. */
  readonly MAIN_VITE_POSTHOG_PROJECT_TOKEN?: string;
  /** The project's ingest host, e.g. `https://eu.i.posthog.com` (no default region). */
  readonly MAIN_VITE_POSTHOG_HOST?: string;
  /** `nightly` for nightly builds; unset (or `production`) for the production app. */
  readonly MAIN_VITE_RELEASE_CHANNEL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
