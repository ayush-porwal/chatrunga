/**
 * The Practice tab's numbers (docs/repertoire-games-and-practice.md §2, §4): per repertoire its
 * due, new, learning and mastered decisions, how many are learned, its perfect lines, and each
 * chapter's moves and due count; plus today's new positions against the daily limit.
 */
import type { RepertoireColor } from "@chaturanga/shared/types/repertoire";
import type {
  PracticeOverview,
  RepertoirePracticeStats
} from "@chaturanga/shared/types/repertoire-practice";
import {
  isLearned,
  masteryOf,
  perfectLineCount,
  practiceLines
} from "@chaturanga/shared/chess/repertoire-mastery";
import { queriesOn } from "../db/rows";
import { repertoireDb } from "./connection";
import {
  chapterRepository,
  decisionRepository,
  repertoireRepository,
  RepertoireCorruptChapterError,
  transaction
} from "./repository";
import { newToday, practiceSettings } from "./practice-limits";
import { clock } from "./service-runtime";

const { all } = queriesOn(repertoireDb);

/** A counted decision's schedule (null fields: never practised). */
type DecisionRow = {
  position_key: string;
  stage: number | null;
  due_at: number | null;
  last_attempt_at: number | null;
};

/** The repertoire's counted decisions (not paused, supported) with their progress. */
function decisionRows(repertoireId: string): DecisionRow[] {
  return all<DecisionRow>(
    `SELECT d.position_key, p.stage, p.due_at, p.last_attempt_at FROM repertoire_decisions d
      LEFT JOIN repertoire_progress p ON p.repertoire_id = d.repertoire_id
        AND p.position_key = d.position_key AND p.suspended = 0
      WHERE d.repertoire_id = ? AND d.paused = 0 AND EXISTS (
        SELECT 1 FROM repertoire_position_index i WHERE i.repertoire_id = d.repertoire_id
        AND i.position_key = d.position_key AND i.is_decision = 1)`,
    repertoireId
  );
}

/** Each chapter's trainable decisions (not paused), by chapter id. */
function chapterMoves(repertoireId: string): Map<string, number> {
  return new Map(
    all<{ chapter_id: string; moves: number }>(
      `SELECT i.chapter_id, COUNT(DISTINCT i.position_key) AS moves FROM repertoire_position_index i
        WHERE i.repertoire_id = ? AND i.is_decision = 1 AND NOT EXISTS (
          SELECT 1 FROM repertoire_decisions d WHERE d.repertoire_id = i.repertoire_id
          AND d.position_key = i.position_key AND d.paused = 1)
        GROUP BY i.chapter_id`,
      repertoireId
    ).map((row) => [row.chapter_id, row.moves])
  );
}

/**
 * Each repertoire's lines (the decision keys each practises), kept per revision: reading every
 * chapter tree is the expensive part, and the lines change only with the repertoire.
 */
const lineCache = new Map<string, { revision: number; lines: string[][] }>();

function linesOf(repertoireId: string, revision: number, color: RepertoireColor): string[][] {
  const cached = lineCache.get(repertoireId);
  if (cached?.revision === revision) return cached.lines;
  let lines: string[][];
  try {
    lines = practiceLines(
      chapterRepository.list(repertoireId),
      color,
      decisionRepository.pausedKeys(repertoireId)
    );
  } catch (error) {
    if (!(error instanceof RepertoireCorruptChapterError)) throw error;
    lines = [];
  }
  lineCache.set(repertoireId, { revision, lines });
  return lines;
}

/** Every active repertoire's practice standing, and today's new positions. */
export function practiceOverview(): PracticeOverview {
  const now = clock();
  return transaction(() => {
    const repertoires = repertoireRepository
      .list({ archived: false }, now)
      .map((summary): RepertoirePracticeStats => {
        const counts = { mastered: 0, learning: 0, new: 0 };
        let learned = 0;
        let learningNotDue = 0;
        let nextDueAt: number | null = null;
        const learnedKeys = new Set<string>();
        for (const row of decisionRows(summary.id)) {
          const progress =
            row.stage === null
              ? null
              : { stage: row.stage, dueAt: row.due_at, lastAttemptAt: row.last_attempt_at };
          const mastery = masteryOf(progress);
          counts[mastery] += 1;
          if (isLearned(progress)) {
            learned += 1;
            learnedKeys.add(row.position_key);
          }
          if (progress?.dueAt != null) {
            if (mastery === "learning" && progress.dueAt > now) learningNotDue += 1;
            if (nextDueAt === null || progress.dueAt < nextDueAt) nextDueAt = progress.dueAt;
          }
        }
        const lines = linesOf(summary.id, summary.revision, summary.color);
        const moves = chapterMoves(summary.id);
        return {
          repertoireId: summary.id,
          name: summary.name,
          color: summary.color,
          chapterCount: summary.chapterCount,
          decisions: summary.decisionCount,
          due: summary.dueCount,
          learned,
          learningNotDue,
          nextDueAt,
          ...counts,
          perfectLines: perfectLineCount(lines, (key) => learnedKeys.has(key)),
          lines: lines.length,
          chapters: chapterRepository.summaries(summary.id, now).map((chapter) => ({
            chapterId: chapter.id,
            moves: moves.get(chapter.id) ?? 0,
            due: chapter.dueCount
          })),
          firstChapterFen: summary.firstChapterFen
        };
      });
    return {
      repertoires,
      newToday: newToday(now),
      newPerDay: practiceSettings().newPerDay
    };
  }, "read");
}
