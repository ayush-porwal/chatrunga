import { HashRouter } from "react-router-dom";
import { ErrorBoundary } from "@/components/error-boundary";
import { App } from "./App";
import { useEngineRegistrySubscription } from "../queries/api";
import { useReviewEventSubscription } from "./useReviewEventSubscription";

/**
 * Top-level router for the desktop renderer.
 *
 * HashRouter (not BrowserRouter) — Electron loads via file:// in production
 * builds, no HTTP server to handle pushState. The hash fragment works
 * identically across dev (vite) and packaged DMG builds.
 *
 * Routes (both render the App shell; Game review is a view inside it):
 *   /                         Home / Game / Settings / Play / Puzzles / Databases.
 *   /games/:id/review         Game Review workspace.
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
  return <App />;
}
