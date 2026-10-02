import { TelemetryService, type TelemetryDeps } from "./service";

/**
 * The app's telemetry service, set up once at startup (main/index.ts). Until then — and in unit
 * tests, which never set it up — every call site sees null and records nothing.
 */
let service: TelemetryService | null = null;

export function initTelemetry(deps: TelemetryDeps): TelemetryService {
  service = new TelemetryService(deps);
  service.start();
  return service;
}

export function getTelemetry(): TelemetryService | null {
  return service;
}
