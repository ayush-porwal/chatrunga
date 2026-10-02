import { HashRouter } from "react-router-dom";
import { ErrorBoundary } from "@/components/error-boundary";
import { App } from "./App";
import { useEngineRegistrySubscription } from "../queries/api";
import { useRepertoireChangedSubscription } from "../queries/repertoire";
import { useReviewEventSubscription } from "./useReviewEventSubscription";

/**
 * Top-level router for the desktop renderer.
 *
 * HashRouter (not BrowserRouter) — Electron loads via file:// in production
 * builds, no HTTP server to handle pushState. The hash fragment works
 * identically across dev (vite) and packaged DMG builds.
 *
 * Routes (all render the App shell; Game review and the repertoire screens are views inside it):
 *   /                                       Home / Game / Settings / Play / Puzzles / Databases.
 *   /games/:id/review                       Game Review workspace.
 *   /repertoires                            Repertoire hub.
 *   /repertoires/:id/chapters/:chapterId    Repertoire study.
 *   /repertoires/:id/practice/:sessionId?   Repertoire practice (no session: its setup).
 *
 * The first-run welcome (features/onboarding) mounts inside <App>, which owns the actions it ends
 * with (review the sample game, import, new game, Settings).
 */
export function Router() {
  return (
    <HashRouter>
      <ErrorBoundary title="Chaturanga hit an unexpected error" scope="app" layout="window">
        <RouterShell />
      </ErrorBoundary>
    </HashRouter>
  );
}

function RouterShell() {
  // Mounted above the views so review events keep flowing across every navigation.
  useReviewEventSubscription();
  useEngineRegistrySubscription();
  useRepertoireChangedSubscription();
  return <App />;
}
