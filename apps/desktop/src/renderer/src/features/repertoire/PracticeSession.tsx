import { useEffect, useId, useMemo } from "react";
import { Eye, Lightbulb, Play, RotateCcw, Route, SkipForward, Square } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import type { Color } from "@chaturanga/shared/types/chess";
import type {
  PracticeAction,
  PracticeAnswer,
  PracticeCard,
  PracticeSessionSnapshot,
  RepertoireDetail,
  RepertoireSummary
} from "@chaturanga/shared/types/repertoire";
import { useRepertoiresQuery } from "../../queries/repertoire";
import { COLOR_LABELS } from "./repertoire-chapters";
import { Button } from "@/components/ui/button";
import { Notice } from "@/components/ui/notice";
import { Stat, StatGroup } from "@/components/ui/stat";
import { useEventCallback } from "@/lib/use-event-callback";
import { isTyping, OVERLAY_SELECTOR } from "../../app/useBoardShortcuts";
import {
  currentCard,
  rehearsalStepNumber,
  rehearsalTitle,
  useRepertoirePracticeStore,
  type RepertoirePracticeState
} from "../../stores/repertoire-practice-store";
import { tabPanelProps } from "@/components/ui/segmented-control";
import { BoardStage, BoardWorkspace } from "../board/BoardWorkspace";
import { PracticeTabBar } from "./PracticeTabBar";
import { ControlledBoard } from "../board/ControlledBoard";
import { isExtraPractice, rehearsePreset, type PracticePreset } from "./practice-setup";
import { firstSightText } from "./practice-messages";
import {
  practiceBoardPosition,
  practiceCardState,
  practiceWayOn,
  positionLine,
  previewOf,
  sessionCounts,
  sessionHeading,
  WAY_ON_LABELS,
  type PendingAttempt,
  type PracticeCardState,
  type PracticeWayOn
} from "./practice-session-model";
import {
  answerView,
  hintMarks,
  hintStageText,
  isPracticeNextKey,
  revealArrows
} from "./repertoire-model";
import { useAdvanceTimer, usePracticePacing } from "./usePracticePacing";
import { usePracticeSessionCommands } from "./usePracticeSessionCommands";

const practice = () => useRepertoirePracticeStore.getState();

/** The footer's way on: its label and what it does (`skips`: not taken by Space / Enter). */
type NextAction = { label: string; onClick: () => void; skips: boolean };

/** One running session: the hidden-answer board and the card's controls. */
export function PracticeSession({
  detail,
  session,
  onRehearse,
  onSettings
}: {
  detail: RepertoireDetail;
  session: PracticeSessionSnapshot;
  /** "Rehearse it from <chapter>": a rehearsal of another chapter from an occurrence there. */
  onRehearse: (preset: PracticePreset) => void;
  /** The repertoire settings (the tab bar's cog). */
  onSettings: () => void;
}) {
  const panelId = useId();
  const card = currentCard(session)!;
  const { hintUci, reveal, correction, leadUpIndex, orientation, rehearsal, otherLine, lineEnded } =
    useRepertoirePracticeStore(
      useShallow((state) => ({
        hintUci: state.hintUci,
        reveal: state.reveal,
        correction: state.correction,
        leadUpIndex: state.leadUpIndex,
        orientation: state.orientation,
        rehearsal: state.rehearsal,
        otherLine: state.otherLine,
        lineEnded: state.lineEnded
      }))
    );
  const rehearsing = session.mode === "rehearse-lines";
  const advance = useAdvanceTimer();
  const commands = usePracticeSessionCommands(session, card, advance);
  const { pending, failed, busy, finish, goNext, act } = commands;
  // A set's cards come from several repertoires: each is played as its own colour.
  const color: Color = card.orientation;
  usePracticePacing({ card, rehearsing, goNext, advance });

  const replaying = leadUpIndex !== null;
  const cardState = practiceCardState(session, card, { reveal, rehearsal, otherLine, lineEnded });
  const board = practiceBoardPosition(card, { leadUpIndex, rehearsal, pending });
  // A first sight shows its move until it is played.
  const preview = previewOf(card);
  const marks = useMemo(() => {
    if (replaying) return { arrows: [], highlights: [] };
    if (reveal) return { arrows: revealArrows(reveal.ucis, reveal.preferredUci), highlights: [] };
    if (correction) {
      return { arrows: revealArrows(correction.ucis, correction.preferredUci), highlights: [] };
    }
    if (preview) return { arrows: revealArrows([preview], preview), highlights: [] };
    return hintMarks(card.hintStage, hintUci);
  }, [replaying, reveal, correction, preview, card.hintStage, hintUci]);
  const rehearsedChapterId = session.scope.rehearse?.chapterId ?? card.chapterId;
  const wayOn = practiceWayOn({ rehearsing, ...cardState, rehearsal, otherLine, lineEnded });
  const takeWayOn: Record<PracticeWayOn, () => void> = {
    summary: goNext,
    "next-card": goNext,
    "continue-line": () => practice().continueStep(),
    "skip-line": () => act("skip"),
    "next-line": goNext
  };
  const nextAction: NextAction | null = wayOn
    ? { label: WAY_ON_LABELS[wayOn], onClick: takeWayOn[wayOn], skips: wayOn === "skip-line" }
    : null;
  usePracticeNextKey(nextAction, busy);

  return (
    <BoardWorkspace
      panelLabel="Practice"
      board={
        <BoardStage
          top={<SessionHeading session={session} card={card} detail={detail} />}
          bottom={
            <p className="flex h-8 items-center text-xs text-fg-muted">
              {replaying
                ? `Lead-up move ${leadUpIndex + 1} of ${card.leadUp.length}`
                : "Play your move on the board"}
            </p>
          }
        >
          <ControlledBoard
            fen={board.fen}
            orientation={orientation}
            movable={cardState.canAnswer && !replaying && !pending && !busy ? color : "none"}
            lastMove={board.lastMove}
            arrows={marks.arrows}
            highlights={marks.highlights}
            onMove={commands.onMove}
          />
        </BoardStage>
      }
      tabPanel={tabPanelProps(panelId, "practice")}
      tabBar={
        <PracticeTabBar
          panelId={panelId}
          label={rehearsing ? "Rehearsal" : "Practice"}
          onSettings={onSettings}
        />
      }
      flushBody
      summary={<SessionStats session={session} card={card} />}
      notices={
        failed ? (
          <Notice
            className="mx-3 mt-3 w-auto"
            tone="danger"
            action={
              <Button type="button" variant="outline" size="xs" onClick={commands.retryFailed}>
                Retry
              </Button>
            }
          >
            {failed.message}
          </Notice>
        ) : null
      }
      footer={<SessionFooter busy={busy} nextAction={nextAction} onEnd={finish} />}
    >
      <div className="scroll-area grid h-full min-h-0 content-start gap-4 overflow-y-auto p-3">
        <PositionContext card={card} color={color} />
        {card.prompt ? (
          <section aria-label="Prompt" className="grid gap-1">
            <p className="text-xs text-fg-muted">Prompt</p>
            <p className="text-sm text-fg">{card.prompt}</p>
          </section>
        ) : null}

        <CardFeedback card={card} pending={pending} preview={preview} />

        {otherLine ? (
          <OtherLineChoice
            otherLine={otherLine}
            followable={otherLine.chapterId === rehearsedChapterId}
            busy={busy}
            onFollow={() => act("follow-other-line")}
            onRehearseThere={() =>
              onRehearse(
                rehearsePreset(
                  { chapterId: otherLine.chapterId, fromNodeId: otherLine.nodeId },
                  session.scope.maxDepthPlies
                )
              )
            }
            onTryAgain={commands.tryAgain}
          />
        ) : null}

        <CardAids
          card={card}
          state={cardState}
          replaying={replaying}
          rehearsing={rehearsing}
          busy={busy}
          onAct={act}
        />
        <CardStatus card={card} retrying={cardState.retrying} />
        {cardState.canAnswer ? (
          <p className="text-2xs text-fg-subtle">
            Play your answer on the board. Hint gives a clue; Reveal shows the move but counts as a
            miss; Skip moves on.
          </p>
        ) : null}
      </div>
    </BoardWorkspace>
  );
}

/**
 * Space / Enter take the way on (never a skip): not while typing a move or in a dialog, and not
 * on a focused button, which Space / Enter already press.
 */
function usePracticeNextKey(nextAction: NextAction | null, busy: boolean): void {
  const onNextKey = useEventCallback((event: KeyboardEvent) => {
    if (!nextAction || nextAction.skips || busy) return;
    const active = document.activeElement;
    const next = isPracticeNextKey(event, {
      typing: isTyping(event.target) || isTyping(active),
      blocked: Boolean(document.querySelector(OVERLAY_SELECTOR)),
      onControl: pressesOnKey(event.target) || pressesOnKey(active)
    });
    if (!next) return;
    event.preventDefault();
    nextAction.onClick();
  });
  useEffect(() => {
    window.addEventListener("keydown", onNextKey);
    return () => window.removeEventListener("keydown", onNextKey);
  }, [onNextKey]);
}

/** Space / Enter already press this focused control (a button, link, switch…). */
function pressesOnKey(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    Boolean(
      target.closest(
        'button, a[href], summary, [role="button"], [role="link"], [role="checkbox"], [role="switch"], [role="radio"], [role="tab"], [role="option"], [role="menuitem"]'
      )
    )
  );
}

/** The repertoires' names and colours by id (a set's cards name their own). */
function useRepertoireNames(): ReadonlyMap<string, Pick<RepertoireSummary, "name" | "color">> {
  const list = useRepertoiresQuery({});
  return useMemo(() => new Map(list.data?.map((item) => [item.id, item])), [list.data]);
}

/**
 * Above the board: the rehearsed line, a weak spot ("Weak spot 3 of 12 · seen in 49 games"), or
 * the card's kind, repertoire and chapter ("Review · Caro-Kann (Black) · Advance Variation"). A
 * set's card names its own repertoire and chapter.
 */
function SessionHeading({
  session,
  card,
  detail
}: {
  session: PracticeSessionSnapshot;
  card: PracticeCard;
  detail: RepertoireDetail;
}) {
  const names = useRepertoireNames();
  const own = (card.repertoireId && names.get(card.repertoireId)) || detail;
  const chapterTitle =
    card.chapterTitle ??
    detail.chapters.find((chapter) => chapter.id === card.chapterId)?.title ??
    "Chapter";
  const repertoire = `${own.name} (${COLOR_LABELS[own.color]})`;
  const extra = session.scope.ungraded
    ? "Extra practice, not scheduled · "
    : isExtraPractice(session.scope) && session.mode !== "weak"
      ? "Extra practice · "
      : "";
  return (
    <p className="flex h-8 min-w-0 items-center text-sm text-fg-secondary">
      <span className="truncate">
        {session.mode === "rehearse-lines"
          ? rehearsalTitle(chapterTitle, session.cards, card)
          : `${extra}${sessionHeading(session, card, { repertoire, chapter: chapterTitle })}`}
      </span>
    </p>
  );
}

/**
 * The session's counters: a rehearsal's step and misses; weak spots' cards left, done and right;
 * else due and new cards left, done, and the share right.
 */
function SessionStats({ session, card }: { session: PracticeSessionSnapshot; card: PracticeCard }) {
  if (session.mode === "rehearse-lines") {
    return (
      <StatGroup className="w-full">
        <Stat label="Progress" value={`step ${rehearsalStepNumber(card)}`} />
        <Stat label="Correct" value={String(session.totals.correct)} />
        <Stat label="Missed" value={String(session.totals.wrong + session.totals.revealed)} />
      </StatGroup>
    );
  }
  const counts = sessionCounts(session.cards);
  const right = counts.right === null ? "–" : `${counts.right}%`;
  if (session.mode === "weak") {
    return (
      <StatGroup className="w-full">
        <Stat label="Left" value={String(counts.due + counts.fresh)} />
        <Stat label="Done" value={String(counts.done)} />
        <Stat label="Right" value={right} />
      </StatGroup>
    );
  }
  return (
    <StatGroup className="w-full">
      <Stat label="Due" value={String(counts.due)} />
      <Stat label="New" value={String(counts.fresh)} />
      <Stat label="Done" value={String(counts.done)} />
      <Stat label="Right" value={right} />
    </StatGroup>
  );
}

/** End session, and the way on once there is one (Space / Enter take it, except a skip). */
function SessionFooter({
  busy,
  nextAction,
  onEnd
}: {
  busy: boolean;
  nextAction: NextAction | null;
  onEnd: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
      <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onEnd}>
        <Square />
        End session
      </Button>
      {nextAction ? (
        <Button
          type="button"
          variant="primary"
          size="sm"
          disabled={busy}
          aria-keyshortcuts={nextAction.skips ? undefined : "Space Enter"}
          title={nextAction.skips ? undefined : `${nextAction.label} (Space or Enter)`}
          onClick={nextAction.onClick}
        >
          {nextAction.label}
          <SkipForward />
        </Button>
      ) : null}
    </div>
  );
}

/**
 * What practice says about the card (announced as it changes): the grade's message, the
 * authored hint, the board's hint in words (arrows and highlights alone aren't accessible), and
 * the answer once it is decided.
 */
function CardFeedback({
  card,
  pending,
  preview
}: {
  card: PracticeCard;
  /** The move being graded (or kept on the board): the answer names it as played. */
  pending: PendingAttempt | null;
  /** A first sight's move, shown until it is played. */
  preview: string | null;
}) {
  const { hint, hintUci, message, reveal, answer, otherLine } = useRepertoirePracticeStore(
    useShallow((state) => ({
      hint: state.hint,
      hintUci: state.hintUci,
      message: state.message,
      reveal: state.reveal,
      answer: state.answer,
      otherLine: state.otherLine
    }))
  );
  const boardHintText = reveal ? null : hintStageText(card.fen, card.hintStage, hintUci);
  return (
    <div aria-live="polite" className="grid gap-2">
      <FirstSightNotice fen={card.fen} preview={preview} />
      {message ? (
        <Notice
          tone={message.tone === "warn" ? "warn" : message.tone === "success" ? "success" : "info"}
          appear
        >
          {message.text}
          {message.feedback ? (
            <span className="block text-fg-muted">{message.feedback}</span>
          ) : null}
          {otherLine ? (
            <span className="block text-fg-muted">
              In {otherLine.chapterTitle}:{" "}
              <span className="font-mono">{otherLine.path || "the start"}</span>
            </span>
          ) : null}
        </Notice>
      ) : null}
      {card.hintStage >= 1 && hint && !reveal ? (
        <Notice tone="info" icon={<Lightbulb />} title="Hint">
          {hint}
        </Notice>
      ) : null}
      {boardHintText ? (
        <Notice tone="info" icon={<Lightbulb />} title="On the board">
          {boardHintText}
        </Notice>
      ) : null}
      {answer ? (
        <AnswerNotes fen={card.fen} answer={answer} playedUci={pending?.uci ?? null} />
      ) : null}
    </div>
  );
}

/**
 * A move from another line: follow it when it is in the rehearsed chapter, else rehearse it from
 * its own chapter; or try again here.
 */
function OtherLineChoice({
  otherLine,
  followable,
  busy,
  onFollow,
  onRehearseThere,
  onTryAgain
}: {
  otherLine: NonNullable<RepertoirePracticeState["otherLine"]>;
  /** The other line is in the rehearsed chapter. */
  followable: boolean;
  busy: boolean;
  onFollow: () => void;
  onRehearseThere: () => void;
  onTryAgain: () => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {followable ? (
        <Button type="button" variant="primary" size="sm" disabled={busy} onClick={onFollow}>
          <Route />
          Follow that line
        </Button>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={onRehearseThere}>
          <Route />
          Rehearse it from {otherLine.chapterTitle}
        </Button>
      )}
      <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onTryAgain}>
        <RotateCcw />
        Try again
      </Button>
    </div>
  );
}

/** The card's aids: the lead-up replay, and help while it can be answered. */
function CardAids({
  card,
  state,
  replaying,
  rehearsing,
  busy,
  onAct
}: {
  card: PracticeCard;
  state: PracticeCardState;
  replaying: boolean;
  rehearsing: boolean;
  busy: boolean;
  onAct: (kind: PracticeAction["kind"]) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {card.leadUp.length && !state.held ? (
        <LeadUpReplayButton replaying={replaying} busy={busy} />
      ) : null}
      {state.canAnswer ? (
        <AnswerAids
          hintStage={card.hintStage}
          finished={state.finished}
          rehearsing={rehearsing}
          disabled={busy || replaying}
          onAct={onAct}
        />
      ) : null}
    </div>
  );
}

/** Replays the moves that led to the card's position (or stops the replay). */
function LeadUpReplayButton({ replaying, busy }: { replaying: boolean; busy: boolean }) {
  return replaying ? (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={() => practice().setLeadUpIndex(null)}
    >
      Skip replay
    </Button>
  ) : (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={busy}
      onClick={() => practice().setLeadUpIndex(0)}
    >
      <Play />
      Replay lead-up
    </Button>
  );
}

const HINT_LABELS = ["Hint", "Show piece", "Show move"];

/** Help while the card can be answered: the next hint stage, the reveal, and a skip until decided. */
function AnswerAids({
  hintStage,
  finished,
  rehearsing,
  disabled,
  onAct
}: {
  hintStage: number;
  finished: boolean;
  rehearsing: boolean;
  disabled: boolean;
  onAct: (kind: PracticeAction["kind"]) => void;
}) {
  const nextHintLabel = HINT_LABELS.at(hintStage) ?? null;
  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled || !nextHintLabel}
        onClick={() => onAct("hint")}
      >
        <Lightbulb />
        {nextHintLabel ?? "No more hints"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => onAct("reveal")}
      >
        <Eye />
        Reveal
      </Button>
      {finished ? null : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => onAct("skip")}
        >
          <SkipForward />
          {rehearsing ? "Skip this line" : "Skip"}
        </Button>
      )}
    </>
  );
}

/**
 * A decided card's answer: the move played (or the reveal's words), the other accepted moves, the
 * position's explanation and the accepted moves' own comments. Rendered only from an answer the
 * main process gave out with the grade.
 */
function AnswerNotes({
  fen,
  answer,
  playedUci
}: {
  fen: string;
  answer: PracticeAnswer;
  playedUci: string | null;
}) {
  const view = answerView(fen, answer, playedUci);
  return (
    <>
      <Notice tone="info" icon={<Eye />} title="Answer">
        {view.answer}
        {view.alternatives ? (
          <span className="block text-fg-muted">{view.alternatives}</span>
        ) : null}
      </Notice>
      {view.explanation ? (
        <Notice tone="info" title="Why">
          {view.explanation}
        </Notice>
      ) : null}
      {view.moveNotes.length ? (
        <Notice tone="info" title="Move notes">
          <ul className="grid gap-1">
            {view.moveNotes.map((note) => (
              <li key={note.uci}>
                <span className="font-mono">{note.san}</span> — {note.text}
              </li>
            ))}
          </ul>
        </Notice>
      ) : null}
    </>
  );
}

/**
 * What the card asks: whose move it is and the line that led here ("1. e4 c5 2. ?"), and for a
 * weak spot how often your games left the repertoire at this position.
 */
function PositionContext({ card, color }: { card: PracticeCard; color: Color }) {
  const games = card.weakGames;
  return (
    <section aria-label="Position" className="grid gap-1">
      <p className="text-xs font-medium text-fg-muted">Your move as {COLOR_LABELS[color]}</p>
      <p className="font-mono text-sm text-fg">{positionLine(card)}</p>
      {games ? (
        <p className="text-xs text-fg-secondary">
          In {games} of your game{games === 1 ? "" : "s"} you played something else here. Find your
          repertoire's move.
        </p>
      ) : null}
    </section>
  );
}

/** A plain sentence for the card's state (text, not colour alone). */
function CardStatus({ card, retrying }: { card: PracticeCard; retrying: boolean }) {
  const text: Record<PracticeCard["state"], string> = {
    unanswered: card.attemptsSoFar
      ? `${card.attemptsSoFar} attempt${card.attemptsSoFar === 1 ? "" : "s"} so far`
      : "",
    "answered-correct": card.hintStage ? "Answered with a hint (assisted)." : "Answered unaided.",
    "answered-wrong": retrying ? "Missed — play the move shown to continue." : "Missed.",
    revealed: "Revealed — counts as missed.",
    skipped: "Skipped."
  };
  return text[card.state] ? <p className="text-xs text-fg-muted">{text[card.state]}</p> : null;
}

/** First sight: the new position's move, until a move is played (its message replaces it). */
function FirstSightNotice({ fen, preview }: { fen: string; preview: string | null }) {
  const answered = useRepertoirePracticeStore((state) => state.message !== null);
  if (!preview || answered) return null;
  return <Notice tone="info">{firstSightText(fen, preview)}</Notice>;
}
