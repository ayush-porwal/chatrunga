import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Notice } from "@/components/ui/notice";
import { fromGamesText, type StudyFromGames } from "./study-from-games";

/**
 * The From your games banner (docs/repertoire-games-and-practice.md §3), when Study opens from
 * Insights: what the user's games did at the position (a move they forgot, a reply they aren't
 * prepared for, staged meanwhile), or a health flag's explanation. A forgotten move offers
 * Practise this position. Dismissible.
 */
export function StudyFromGamesBanner({
  fromGames,
  fen,
  onPractise,
  onDismiss
}: {
  fromGames: StudyFromGames;
  /** The position (numbers the moves; null: SAN alone). */
  fen: string | null;
  onPractise?: (positionKey: string) => void;
  onDismiss: () => void;
}) {
  return (
    <Notice
      tone="info"
      aria-label="From your games"
      action={<IconButton label="Dismiss" icon={<X />} size="icon-xs" onClick={onDismiss} />}
    >
      <p>{fromGamesText(fromGames, fen)}</p>
      {fromGames.kind === "forgot" && onPractise ? (
        <div className="pt-1">
          <Button
            type="button"
            variant="outline"
            size="xs"
            onClick={() => onPractise(fromGames.positionKey)}
          >
            Practise this position
          </Button>
        </div>
      ) : null}
    </Notice>
  );
}
