import { useEffect, useRef, useState, type ReactNode } from "react";
import { Lightbulb, X } from "lucide-react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { AppSettings, OnboardingHintId } from "@chaturanga/shared/types/settings";
import { IconButton } from "@/components/ui/icon-button";
import { cn } from "@/lib/utils";
import { useSettingsQuery, useUpdateSettingMutation } from "../../queries/api";

/**
 * Tips shown during the current review (not yet stored as seen). They are stored when the review
 * is left (useStoreHintsOnLeave), so each tip appears in one review only, dismissed or not.
 */
const shownThisReview = new Set<OnboardingHintId>();
/** Dismissed in this session (hidden at once, before the saved setting round-trips). */
const dismissed = new Set<OnboardingHintId>();

/**
 * One-time Game review tip: visible while `eligible` (e.g. commentary with move links is on
 * screen) until it is dismissed or its first review ends. Never shown before settings load.
 */
export function useOnboardingHint(
  id: OnboardingHintId,
  eligible: boolean
): { visible: boolean; dismiss: () => void } {
  const settings = useSettingsQuery();
  const { mutate: updateSetting } = useUpdateSettingMutation();
  const [, rerender] = useState(0);
  const seen = settings.data?.onboardingHintsSeen ?? [];
  const visible =
    eligible &&
    settings.isSuccess &&
    Boolean(window.chaturanga) &&
    !seen.includes(id) &&
    !dismissed.has(id);

  useEffect(() => {
    if (visible) shownThisReview.add(id);
  }, [id, visible]);

  return {
    visible,
    dismiss: () => {
      dismissed.add(id);
      shownThisReview.delete(id);
      updateSetting({ key: "onboardingHintsSeen", value: [...new Set([...seen, id])] });
      rerender((count) => count + 1);
    }
  };
}

/**
 * Mount in the review page: stores the tips it showed as seen when the review is left — the page
 * unmounts, or it switches to another game's review (the page stays mounted then, so `reviewKey`,
 * e.g. the game id, marks the change).
 */
export function useStoreHintsOnLeave(reviewKey: string | null): void {
  const queryClient = useQueryClient();
  const mounted = useRef(false);
  const lastKey = useRef(reviewKey);

  useEffect(() => {
    if (lastKey.current === reviewKey) return;
    lastKey.current = reviewKey;
    storeShownHints(queryClient);
  }, [queryClient, reviewKey]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      // Deferred: StrictMode's simulated unmount remounts at once, which is not leaving the review.
      window.setTimeout(() => {
        if (!mounted.current) storeShownHints(queryClient);
      }, 0);
    };
  }, [queryClient]);
}

/** Persists the tips shown in the review being left (straight through the API: the page's own mutation observers may be gone). */
function storeShownHints(queryClient: QueryClient): void {
  if (!shownThisReview.size) return;
  const current = queryClient.getQueryData<AppSettings>(["settings"]);
  const value = [...new Set([...(current?.onboardingHintsSeen ?? []), ...shownThisReview])];
  shownThisReview.clear();
  if (current) queryClient.setQueryData<AppSettings>(["settings"], { ...current, onboardingHintsSeen: value });
  void window.chaturanga?.settings
    .set("onboardingHintsSeen", value)
    .finally(() => queryClient.invalidateQueries({ queryKey: ["settings"] }));
}

/** A small, dismissible inline tip. Not a popover: it sits in the flow next to what it explains. */
export function Coachmark({
  children,
  onDismiss,
  className
}: {
  children: ReactNode;
  onDismiss: () => void;
  className?: string;
}) {
  return (
    <div
      role="note"
      className={cn(
        "flex animate-rise-in items-start gap-2.5 rounded-lg border border-accent/25 bg-accent-soft/70 py-2 pl-3 pr-1.5 text-xs leading-5 text-accent-fg",
        className
      )}
    >
      <Lightbulb className="mt-0.5 size-3.5 shrink-0 text-accent" aria-hidden />
      <p className="min-w-0 flex-1">{children}</p>
      <IconButton
        label="Dismiss tip"
        icon={<X />}
        size="icon-xs"
        tooltip={false}
        className="-my-0.5 text-accent-fg/70"
        onClick={onDismiss}
      />
    </div>
  );
}
