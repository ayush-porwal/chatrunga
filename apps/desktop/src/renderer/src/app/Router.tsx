import { HashRouter } from "react-router-dom";
import { ErrorBoundary } from "@/components/error-boundary";
import { WelcomeModal } from "../features/onboarding/WelcomeModal";
import { useFirstLaunch } from "../features/onboarding/useFirstLaunch";
import { App } from "./App";
import { useReviewEventSubscription } from "./useReviewEventSubscription";

/**
 * Top-level router for the desktop renderer.
 *
 * HashRouter (not BrowserRouter) — Electron loads via file:// in production
 * builds, no HTTP server to handle pushState. The hash fragment works
 * identically across dev (vite) and packaged DMG builds.
 *
 * Routes (both render the App shell; Game review is a view inside it):
 *   /                         Home / Game / Settings / Engine game / Puzzles / Databases.
 *   /games/:id/review         Game Review workspace.
 *
 * <WelcomeModal> mounts here so it's visible regardless of which route the user lands on.
 * It auto-shows on first launch when no engines are installed and the user hasn't dismissed it.
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
  const firstLaunch = useFirstLaunch();
  // Mounted above the views so review events keep flowing across every navigation.
  useReviewEventSubscription();
  return (
    <>
      <App />
      {firstLaunch.showWelcome ? (
        <WelcomeModal onMaybeLater={firstLaunch.dismissPermanently} onDismiss={firstLaunch.dismiss} />
      ) : null}
    </>
  );
}
