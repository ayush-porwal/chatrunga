/** Editing the policy at one position (design §7.1): accepted moves, preference, texts, pause. */
import type { MoveNode } from "@chaturanga/shared/types/chess";
import {
  POSITION_NOT_FOUND_ERROR,
  type DecisionSaveResult,
  type RepertoireChapter,
  type RepertoireNodeMeta,
  type UpdateDecisionInput
} from "@chaturanga/shared/types/repertoire";
import { playerToMove } from "@chaturanga/shared/chess/repertoire-position";
import {
  buildChapterLookup,
  computeScopeStates,
  nodeMetaOf,
  type ChapterLookup
} from "@chaturanga/shared/chess/repertoire-index";
import {
  bump,
  checkRevision,
  detail,
  memoizedPositionKey,
  reindex,
  reindexPositions,
  requireRepertoire,
  storedKeySeed,
  stripFingerprint
} from "./core";
import { cleanText, fenAfterMove, MAX_POLICY_TEXT, normalizeUci } from "./chapter-validation";
import {
  chapterRepository,
  decisionRepository,
  positionIndexRepository,
  transaction,
  type RepertoireRecord,
  type StoredDecision
} from "./repository";
import { changed, clock } from "./service-runtime";

type Occurrence = {
  chapter: RepertoireChapter;
  lookup: ChapterLookup;
  nodeId: string;
  node: MoveNode;
};

/** The child of an occurrence that plays `uci`, if any. */
function childPlaying(occurrence: Occurrence, uci: string): MoveNode | null {
  for (const childId of occurrence.lookup.childrenById.get(occurrence.nodeId) ?? []) {
    const child = occurrence.lookup.nodesById.get(childId)!;
    if (child.uci === uci) return child;
  }
  return null;
}

function isActiveIncluded(occurrence: Occurrence, child: MoveNode): boolean {
  const { chapter } = occurrence;
  if (!chapter.enabled || chapter.kind !== "opening") return false;
  if (nodeMetaOf(chapter.nodeMeta, child.id).edge !== "included") return false;
  const states = computeScopeStates(chapter, occurrence.lookup);
  return states.get(occurrence.nodeId) === "active" && states.get(child.id) === "active";
}

/** The occurrences of `positionKey` where the repertoire's side is to move. */
function decisionOccurrences(
  record: RepertoireRecord,
  positionKey: string,
  allOfThem: boolean
): Occurrence[] {
  // Only chapters the index places the position in can hold it; their keys come from the index.
  // Without new accepted moves no edge changes, so the first chapter holding it is enough.
  const chapterIds = new Set(
    positionIndexRepository
      .occurrences(record.id, positionKey)
      .map((occurrence) => occurrence.chapterId)
  );
  const occurrences: Occurrence[] = [];
  for (const chapterId of chapterIds) {
    if (occurrences.length && !allOfThem) break;
    const stored = chapterRepository.get(chapterId)!;
    const chapter = { ...stored, nodeMeta: { ...stored.nodeMeta } };
    const seed = storedKeySeed(chapter, positionIndexRepository.chapterKeys(chapter.id));
    const lookup = buildChapterLookup(chapter, memoizedPositionKey(seed));
    for (const nodeId of lookup.order) {
      if (lookup.positionKeys.get(nodeId) !== positionKey) continue;
      const node = lookup.nodesById.get(nodeId)!;
      if (playerToMove(node.fenAfter) !== record.color) continue;
      occurrences.push({ chapter, lookup, nodeId, node });
    }
  }
  return occurrences;
}

/** Sets a move's edge in its occurrence's chapter, remembering which chapters changed. */
type EdgeWriter = {
  set: (occurrence: Occurrence, child: MoveNode, edge: RepertoireNodeMeta["edge"]) => void;
  touched: Set<RepertoireChapter>;
};

function edgeWriter(): EdgeWriter {
  const touched = new Set<RepertoireChapter>();
  return {
    touched,
    set: (occurrence, child, edge) => {
      occurrence.chapter.nodeMeta[child.id] = {
        ...nodeMetaOf(occurrence.chapter.nodeMeta, child.id),
        edge
      };
      touched.add(occurrence.chapter);
    }
  };
}

/** The accepted moves in stored form, each legal in the position. */
function acceptedMovesAt(fen: string, ucis: readonly string[]): string[] {
  const accepted = [...new Set(ucis.map((uci) => normalizeUci(fen, uci)))];
  for (const uci of accepted) {
    if (!fenAfterMove(fen, uci)) {
      throw new Error(`Invalid acceptedUcis: "${uci}" is not a legal move in this position`);
    }
  }
  return accepted;
}

/**
 * Every accepted move gets an active included occurrence: when none supports it yet, the first
 * occurrence that can train it becomes `included`. A move no longer accepted turns its included
 * occurrences into reference moves.
 */
function selectOccurrences(
  occurrences: readonly Occurrence[],
  accepted: readonly string[],
  previouslyAccepted: readonly string[],
  edges: EdgeWriter
): void {
  for (const uci of accepted) {
    const candidates = occurrences.filter((occurrence) => childPlaying(occurrence, uci));
    if (!candidates.length) {
      throw new Error(
        `Invalid acceptedUcis: "${uci}" has no occurrence in this repertoire; play it on the board first`
      );
    }
    if (
      candidates.some((occurrence) => isActiveIncluded(occurrence, childPlaying(occurrence, uci)!))
    ) {
      continue;
    }
    for (const occurrence of candidates) {
      const child = childPlaying(occurrence, uci)!;
      const meta: Partial<Record<string, RepertoireNodeMeta>> = occurrence.chapter.nodeMeta;
      const before = meta[child.id];
      edges.set(occurrence, child, "included");
      if (isActiveIncluded(occurrence, child)) break;
      // This occurrence can't train (disabled, reference chapter, outside its boundaries).
      if (before) occurrence.chapter.nodeMeta[child.id] = before;
      else delete occurrence.chapter.nodeMeta[child.id];
    }
  }
  for (const uci of previouslyAccepted.filter((uci) => !accepted.includes(uci))) {
    for (const occurrence of occurrences) {
      const child = childPlaying(occurrence, uci);
      if (child && nodeMetaOf(occurrence.chapter.nodeMeta, child.id).edge === "included") {
        edges.set(occurrence, child, "reference");
      }
    }
  }
}

/**
 * Wrong-move feedback by move, for legal moves only. The whole map is replaced: a move left out
 * (or with blank text) loses its feedback.
 */
function wrongMoveFeedbackAt(
  fen: string,
  feedback: Record<string, string>,
  accepted: readonly string[],
  storedFeedback: Record<string, string>
): Record<string, string> {
  const next: Record<string, string> = {};
  for (const [uci, text] of Object.entries(feedback)) {
    const move = normalizeUci(fen, uci);
    if (!fenAfterMove(fen, move)) {
      throw new Error(`Invalid wrongMoveFeedback: "${uci}" is not a legal move in this position`);
    }
    const cleaned = cleanText(text, MAX_POLICY_TEXT);
    if (!cleaned) continue;
    // Feedback explains a wrong move: an accepted one takes none. Feedback stored before its
    // move was accepted (and sent back unchanged with the rest of the map) is dropped.
    if (accepted.includes(move)) {
      if (storedFeedback[move] === cleaned) continue;
      throw new Error(`Invalid wrongMoveFeedback: "${uci}" is an accepted move in this position`);
    }
    next[move] = cleaned;
  }
  return next;
}

/**
 * The decision with the patch applied: the accepted moves first, since the preference and the
 * wrong-move feedback are checked against them.
 */
function patchedDecision(
  stored: StoredDecision,
  patch: UpdateDecisionInput["patch"],
  occurrences: readonly Occurrence[],
  edges: EdgeWriter
): StoredDecision {
  const fen = occurrences[0].node.fenAfter;
  const next: StoredDecision = { ...stored, acceptedUcis: [...stored.acceptedUcis] };
  if (patch.acceptedUcis !== undefined) {
    const accepted = acceptedMovesAt(fen, patch.acceptedUcis);
    selectOccurrences(occurrences, accepted, stored.acceptedUcis, edges);
    next.acceptedUcis = accepted;
    if (next.preferredUci && !accepted.includes(next.preferredUci)) {
      next.preferredUci = accepted[0] ?? null;
    }
  }
  if (patch.preferredUci !== undefined) {
    const preferred = patch.preferredUci === null ? null : normalizeUci(fen, patch.preferredUci);
    if (preferred !== null && !next.acceptedUcis.includes(preferred)) {
      throw new Error("Invalid preferredUci: it must be one of the accepted moves");
    }
    next.preferredUci = preferred;
  }
  if (patch.prompt !== undefined) next.prompt = cleanText(patch.prompt, MAX_POLICY_TEXT);
  if (patch.hint !== undefined) next.hint = cleanText(patch.hint, MAX_POLICY_TEXT);
  if (patch.wrongMoveFeedback !== undefined) {
    next.wrongMoveFeedback = wrongMoveFeedbackAt(
      fen,
      patch.wrongMoveFeedback,
      next.acceptedUcis,
      stored.wrongMoveFeedback
    );
  }
  if (patch.paused !== undefined) next.paused = patch.paused;
  return next;
}

/** The decision a position has before any policy is set there. */
function emptyDecision(repertoireId: string, positionKey: string): StoredDecision {
  return {
    repertoireId,
    positionKey,
    acceptedUcis: [],
    preferredUci: null,
    prompt: null,
    hint: null,
    wrongMoveFeedback: {},
    paused: false,
    acceptanceFingerprint: ""
  };
}

/**
 * Updates the policy at one position. Accepting a move with no supporting included occurrence
 * selects one (its edge becomes `included`) in the same transaction (§7.1); removing an accepted
 * move turns its included occurrences into reference moves so reconciliation doesn't re-add it.
 * A move with no occurrence at all in the repertoire is refused. Wrong-move feedback names legal
 * moves of the position. Pausing keeps the decision's progress: a paused decision is left out of
 * practice and due counts, and resuming it brings back its schedule as it was.
 */
export function updateDecision(input: UpdateDecisionInput): DecisionSaveResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    const { patch, positionKey } = input;
    const occurrences = decisionOccurrences(record, positionKey, patch.acceptedUcis !== undefined);
    if (!occurrences.length) throw new Error(POSITION_NOT_FOUND_ERROR);
    const stored =
      decisionRepository.get(record.id, positionKey) ?? emptyDecision(record.id, positionKey);
    const edges = edgeWriter();
    const next = patchedDecision(stored, patch, occurrences, edges);

    const bumped = bump(record, now);
    for (const chapter of edges.touched) {
      chapterRepository.upsert(record.id, { ...chapter, revision: chapter.revision + 1 }, now);
    }
    decisionRepository.upsert(next, now);
    // A change that rewrote chapter edges rebuilds the whole repertoire. New accepted moves or a
    // cleared preference reconcile the decision's own position only. Anything else (prompt, hint,
    // feedback, pause, another accepted preference) leaves the derived state as it was.
    if (edges.touched.size) reindex(bumped, now);
    else if (patch.acceptedUcis !== undefined || patch.preferredUci === null) {
      reindexPositions(bumped, [positionKey], now);
    }
    return {
      repertoire: detail(record.id, now),
      decision: stripFingerprint(decisionRepository.get(record.id, positionKey)!)
    };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}
