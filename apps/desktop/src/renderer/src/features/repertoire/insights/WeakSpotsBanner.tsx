import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useInsightsWeakSpotsQuery } from "../../../queries/repertoire-insights";
import { useOpenSettings } from "../../settings/settings-link";

/**
 * The Practice tab's "Weak spots from your games" banner (docs/repertoire-games-and-practice.md
 * §4): the positions where the user left a repertoire in real games (under the Insights filters),
 * with Practise weak spots and See the report. Without a connected account it says how to get
 * them; otherwise it renders nothing until Insights has a forgotten position.
 */
export function WeakSpotsBanner({
  onPractise,
  onSeeReport
}: {
  /** Weak-spots practice over every forgotten position. */
  onPractise: () => void;
  /** Repertoire → Insights. */
  onSeeReport: () => void;
}) {
  const weakSpots = useInsightsWeakSpotsQuery();
  const openSettings = useOpenSettings();
  const summary = weakSpots.data;
  if (!summary) return null;
  if (!summary.accounts && !summary.positions) {
    return (
      <Notice
        tone="info"
        appear={false}
        action={
          openSettings ? (
            <Button
              type="button"
              size="xs"
              variant="outline"
              onClick={() => openSettings("lichess")}
            >
              Open Settings
            </Button>
          ) : null
        }
      >
        Connect Lichess or Chess.com in Settings to find weak spots from your games.
      </Notice>
    );
  }
  if (!summary.positions) return null;
  return (
    <Notice
      tone="warn"
      appear={false}
      title="Weak spots from your games"
      action={
        <div className="flex items-center gap-2">
          <Button type="button" size="xs" variant="ghost" onClick={onSeeReport}>
            See the report
          </Button>
          <Button type="button" size="xs" variant="primary" onClick={onPractise}>
            Practice weak spots
          </Button>
        </div>
      }
    >
      {summary.positions} position{summary.positions === 1 ? "" : "s"} where you left your
      repertoire in real games, then the replies you meet most.
    </Notice>
  );
}
