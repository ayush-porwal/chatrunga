import { BookOpen, GraduationCap, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { useGameStore } from "../../../stores/game-store";
import type { StudyOpenTarget } from "../repertoire-chapters";
import { plyMoveLabel } from "./insights-format";
import { useInsightsReturnStore, type InsightsReviewFocus } from "./insights-return";
import { decisionNodeId } from "./insights-review";

/**
 * Game review's "From your games" band, while the game Insights opened is on screen: what happened
 * to the game's opening in one sentence, and the fix — practise the position you forgot, open it in
 * Study, or prepare the reply your repertoire doesn't cover — plus Show the move (the position where
 * it happened, with the board's arrows). It shows whether or not the game has been analysed.
 */
export function InsightsReviewNotice({
  onStudy,
  onRefreshDecision
}: {
  onStudy?: (target: StudyOpenTarget) => void;
  onRefreshDecision?: (repertoireId: string, positionKey: string) => void;
}) {
  const gameId = useGameStore((state) => state.gameId);
  const moveTree = useGameStore((state) => state.moveTree);
  const fromInsights = useInsightsReturnStore((state) => state.gameId);
  const focus = useInsightsReturnStore((state) => state.focus);
  if (!focus || !gameId || fromInsights !== gameId) return null;
  const text = insightsReviewText(focus);
  if (!text) return null;
  const decision = focus.issue ? decisionNodeId(moveTree, focus.issue.ply) : null;
  return (
    <div className="shrink-0 border-b border-line-subtle">
      <Notice
        tone={focus.outcome === "forgot" ? "warn" : "info"}
        title="From your games"
        appear={false}
        className="items-center rounded-none border-0 px-3 py-2.5 [&>svg]:mt-0"
        action={
          <BandActions
            decision={decision}
            fix={fixOf(focus)}
            onStudy={onStudy}
            onRefreshDecision={onRefreshDecision}
          />
        }
      >
        {text}
      </Notice>
    </div>
  );
}

/** Show the move, then the fix: Practise this position and Open in Study, or Prepare a reply. */
function BandActions({
  decision,
  fix,
  onStudy,
  onRefreshDecision
}: {
  decision: string | null;
  fix: Fix | null;
  onStudy?: (target: StudyOpenTarget) => void;
  onRefreshDecision?: (repertoireId: string, positionKey: string) => void;
}) {
  const study = fix?.study ?? null;
  return (
    <span className="flex flex-wrap justify-end gap-1.5">
      {decision ? (
        <Button
          type="button"
          variant="ghost"
          size="xs"
          onClick={() => useGameStore.getState().goToNode(decision)}
        >
          Show the move
        </Button>
      ) : null}
      {fix?.kind === "forgot" && onRefreshDecision ? (
        <Button
          type="button"
          variant="primary"
          size="xs"
          onClick={() => onRefreshDecision(fix.repertoireId, fix.positionKey)}
        >
          <GraduationCap />
          Practise this position
        </Button>
      ) : null}
      {study && onStudy ? (
        <Button
          type="button"
          variant={fix?.kind === "forgot" ? "outline" : "primary"}
          size="xs"
          onClick={() => onStudy(study)}
        >
          {fix?.kind === "forgot" ? <BookOpen /> : <Plus />}
          {fix?.kind === "forgot" ? "Open in Study" : "Prepare a reply"}
        </Button>
      ) : null}
    </span>
  );
}

/** The band's sentence for a game's outcome (null: nothing worth saying). */
export function insightsReviewText(focus: InsightsReviewFocus): string | null {
  const { issue } = focus;
  const played = issue?.played ? plyMoveLabel(issue.ply, issue.played) : null;
  const repertoire = focus.repertoireName ? `“${focus.repertoireName}”` : "your repertoire";
  switch (focus.outcome) {
    case "forgot": {
      const expected = issue?.expected.map((san) => plyMoveLabel(issue.ply, san)).join(" or ");
      return played && expected
        ? `You left ${repertoire} here: you played ${played}, but it has ${expected}.`
        : `You left ${repertoire} in this game.`;
    }
    case "new-reply":
      return played
        ? `Your opponent played ${played} here, which ${repertoire} doesn't answer yet.`
        : `Your opponent left ${repertoire} with a reply it doesn't answer yet.`;
    case "ended-in-book":
      return `You followed ${repertoire} to the end of your preparation.`;
    case "in-book":
      return `The game ended inside ${repertoire}.`;
    case "not-covered":
      return played
        ? `${played} isn't in your repertoire: this game is another opening.`
        : "This game is another opening than your repertoire's.";
    case "no-repertoire":
      return focus.color
        ? `You have no ${focus.color === "white" ? "White" : "Black"} repertoire to compare this game with.`
        : null;
    default:
      return null;
  }
}

type Fix = {
  kind: "forgot" | "new-reply";
  repertoireId: string;
  positionKey: string;
  study: StudyOpenTarget | null;
};

/** What the band offers: the forgotten position, or the reply to prepare (null: nothing to fix). */
function fixOf(focus: InsightsReviewFocus): Fix | null {
  const { issue, repertoireId } = focus;
  if (!issue?.positionKey || !repertoireId) return null;
  const place = issue.study;
  if (focus.outcome === "forgot") {
    return {
      kind: "forgot",
      repertoireId,
      positionKey: issue.positionKey,
      study: place && {
        repertoireId,
        ...place,
        tab: "moves",
        fromGames: {
          kind: "forgot",
          positionKey: issue.positionKey,
          played:
            issue.played && issue.playedUci
              ? [{ uci: issue.playedUci, san: issue.played, games: 1 }]
              : [],
          expectedSans: issue.expected
        }
      }
    };
  }
  if (focus.outcome === "new-reply" && issue.played && issue.playedUci) {
    const reply = { uci: issue.playedUci, san: issue.played, games: 1 };
    return {
      kind: "new-reply",
      repertoireId,
      positionKey: issue.positionKey,
      study: place && {
        repertoireId,
        ...place,
        tab: "moves",
        stage: { nodeId: place.nodeId, uci: reply.uci },
        fromGames: { kind: "unprepared", positionKey: issue.positionKey, reply }
      }
    };
  }
  return null;
}
