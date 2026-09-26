import { useEffect, useState } from "react";
import { fetchAssetStatus, missingDownloads } from "@/lib/engine-assets";

/**
 * First-launch detection — shows the WelcomeModal when ALL of these are true:
 *   - The user has not configured any engine yet (no rows in the engines table).
 *   - The asset manager reports at least one asset missing that can be downloaded here.
 *   - The user has not dismissed the modal with "I'll use my own engines".
 *
 * The dismissal is stored in localStorage so it survives restarts. Users who already have
 * engines configured are never shown the download flow.
 */

const DISMISS_KEY = "chaturanga.welcome.dismissed";

export function useFirstLaunch(): {
  showWelcome: boolean;
  dismiss: () => void;
  dismissPermanently: () => void;
} {
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      if (localStorage.getItem(DISMISS_KEY) === "1") return;
      const api = window.chaturanga;
      if (!api) return;
      try {
        const engines = await api.engines.list();
        if (cancelled) return;
        if (engines.length > 0) {
          // Not a first-launch user: never offer the download flow again.
          localStorage.setItem(DISMISS_KEY, "1");
          return;
        }
        const status = await fetchAssetStatus();
        if (!cancelled && missingDownloads(status).length > 0) setShowWelcome(true);
      } catch {
        // If the checks fail, skip the modal rather than nag a returning user with a broken downloader.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return {
    showWelcome,
    dismiss: () => setShowWelcome(false),
    dismissPermanently: () => {
      localStorage.setItem(DISMISS_KEY, "1");
      setShowWelcome(false);
    }
  };
}
