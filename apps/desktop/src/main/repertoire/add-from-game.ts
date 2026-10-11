/** Adding material from a game (design §6.2) and the provenance links to games. */
import { nanoid } from "nanoid";
import type { GameHeaders, MoveNode } from "@chaturanga/shared/types/chess";
import {
  CHAPTER_NOT_FOUND_ERROR,
  REPERTOIRE_ROOT_NODE_ID,
  type AddFromGameInput,
  type AddFromGamePreview,
  type AddFromGameResult,
  type AddFromGameScope,
  type ChapterKind,
  type RepertoireChapter,
  type RepertoireColor,
  type LinkGameInput,
  type RepertoireGameLink
} from "@chaturanga/shared/types/repertoire";
import { playerToMove, positionKey } from "@chaturanga/shared/chess/repertoire-position";
import {
  applyPolicy,
  extractScope,
  listOpponentMoves,
  listOwnMoves,
  pathToPosition,
  proposePolicy,
  untrainedMoveWarnings,
  type AddFromGamePolicy,
  type ExtractedScope
} from "@chaturanga/shared/chess/repertoire-add-from-game";
import { mergeIntoChapter } from "@chaturanga/shared/chess/repertoire-merge";
import {
  buildChapterLookup,
  collectDecisions,
  effectiveAcceptedUcis,
  type ChapterLookup
} from "@chaturanga/shared/chess/repertoire-index";
import { formatPath } from "@chaturanga/shared/chess/repertoire-pgn";
import { gameRepository } from "../db/repositories";
import { bump, checkRevision, detail, reindex, requireRepertoire } from "./core";
import {
  chapterTitle,
  isValidFen,
  sanitizeChapter,
  sanitizeHeaders,
  validateTree
} from "./chapter-validation";
import {
  chapterRepository,
  decisionRepository,
  positionIndexRepository,
  transaction,
  type RepertoireRecord
} from "./repository";
import { gameLinkRepository, libraryGameExists } from "./game-link-repository";
import { changed, clock, loadChapter } from "./service-runtime";

type AddFromGamePlan = {
  /** The chapter as it would be stored (sanitised; next chapter revision). */
  chapter: RepertoireChapter;
  preview: AddFromGamePreview;
  linkHeaders: Record<string, string>;
  gameNodeId: string | null;
  capturedPath: string;
};

/** A title from the game's tags when the dialog gives none. */
function gameTitle(headers: Partial<Record<string, string>>): string {
  const known = (value: string | undefined) => {
    const trimmed = value?.trim();
    return trimmed && trimmed !== "?" ? trimmed : null;
  };
  const white = known(headers.White ?? headers.white);
  const black = known(headers.Black ?? headers.black);
  if (white && black) return `${white} – ${black}`;
  return known(headers.Event ?? headers.event) ?? "Game excerpt";
}

/** The game tree checked like a chapter tree (legal moves, root "root", castling as e1g1). */
function validateSourceTree(input: AddFromGameInput["source"]): {
  rootFen: string;
  tree: MoveNode[];
} {
  const rootFen = typeof input.rootFen === "string" ? input.rootFen.trim() : "";
  if (!rootFen || !isValidFen(rootFen)) {
    throw new Error("Invalid source rootFen: not a legal position");
  }
  if (!Array.isArray(input.tree)) throw new Error("Invalid source tree: expected an array");
  try {
    return { rootFen, tree: validateTree(input.tree, rootFen) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Invalid chapter tree/, "Invalid source tree"), {
      cause: error
    });
  }
}

/**
 * The policy's source ids must name moves of the copied material (not its context): included
 * moves must be the repertoire side's, covered moves the opponent's.
 */
function checkPolicy(
  color: RepertoireColor,
  extracted: ExtractedScope,
  policy: AddFromGamePolicy
): void {
  const byId = new Map(extracted.tree.map((node) => [node.id, node]));
  const context = new Set(extracted.contextNodeIds);
  // A policy may name ids the extraction never copied.
  const chapterIds: Partial<Record<string, string>> = extracted.sourceToChapterIds;
  const moveOf = (sourceId: string): MoveNode => {
    const chapterId = chapterIds[sourceId];
    const node = chapterId === undefined ? undefined : byId.get(chapterId);
    if (!node || node.id === REPERTOIRE_ROOT_NODE_ID || context.has(sourceId)) {
      throw new Error(`Invalid policy: node "${sourceId}" is not part of the selected material`);
    }
    return node;
  };
  for (const id of policy.includedNodeIds) {
    if (playerToMove(moveOf(id).fenBefore) !== color) {
      throw new Error(
        `Invalid policy: node "${id}" is not a ${color} move, so it can't be accepted`
      );
    }
  }
  for (const id of policy.coveredNodeIds) {
    if (playerToMove(moveOf(id).fenBefore) === color) {
      throw new Error(
        `Invalid policy: node "${id}" is not an opponent move, so it can't be covered`
      );
    }
  }
}

/** Source nodes from the root to the scope's end (whole game: the end of its main line). */
function capturedRoute(tree: readonly MoveNode[], scope: AddFromGameScope): MoveNode[] {
  const byId = new Map(tree.map((node) => [node.id, node]));
  let end = byId.get(REPERTOIRE_ROOT_NODE_ID)!;
  if (scope.kind === "path") end = byId.get(scope.toNodeId) ?? end;
  else if (scope.kind === "subtree") end = byId.get(scope.fromNodeId) ?? end;
  else {
    while (end.children.length && byId.has(end.children[0])) end = byId.get(end.children[0])!;
  }
  const route: MoveNode[] = [];
  for (let node: MoveNode | undefined = end; node && node.parentId !== null; ) {
    route.unshift(node);
    node = byId.get(node.parentId);
  }
  return route;
}

/** SAN of `uci` played at a position of the chapter (falls back to the UCI). */
function sanInChapter(lookup: ChapterLookup, key: string, uci: string): string {
  for (const id of lookup.order) {
    if (lookup.positionKeys.get(id) !== key) continue;
    for (const childId of lookup.childrenById.get(id) ?? []) {
      const child = lookup.nodesById.get(childId)!;
      if (child.uci === uci && child.san) return child.san;
    }
  }
  return uci;
}

/** Where the material goes: the existing chapter it merges into (null: a new one), and its kind. */
type Destination = { existing: RepertoireChapter | null; kind: ChapterKind };

function destinationOf(
  record: RepertoireRecord,
  destination: AddFromGameInput["destination"],
  now: number
): Destination {
  if (destination.kind !== "existing-chapter")
    return { existing: null, kind: destination.chapterKind };
  const existing = loadChapter(record.id, destination.chapterId, now);
  return { existing, kind: existing.kind };
}

/** The chapter as it would be stored, the moves it had already, and copied → stored ids. */
type Draft = {
  draft: RepertoireChapter;
  alreadyPresent: number;
  chapterIds: Partial<Record<string, string>>;
};

/**
 * The material merged into the destination chapter. Opponent context moves may cover a matched
 * reference edge; the player's context moves stay as they are (they can't be accepted here), and
 * moves below them are reported untrained.
 */
function mergedDraft(
  record: RepertoireRecord,
  existing: RepertoireChapter,
  extracted: ExtractedScope,
  policy: AddFromGamePolicy
): Draft {
  const byId = new Map(extracted.tree.map((node) => [node.id, node]));
  const opponentContext = extracted.contextNodeIds.filter((id) => {
    const node = byId.get(extracted.sourceToChapterIds[id]);
    return node !== undefined && playerToMove(node.fenBefore) !== record.color;
  });
  const merged = mergeIntoChapter(existing, {
    rootFen: extracted.rootFen,
    tree: extracted.tree,
    nodeMeta: applyPolicy(extracted, policy),
    upgradeNodeIds: [...policy.includedNodeIds, ...policy.coveredNodeIds, ...opponentContext].map(
      (id) => extracted.sourceToChapterIds[id]
    )
  });
  return {
    draft: merged.chapter,
    alreadyPresent: merged.alreadyPresent,
    chapterIds: Object.fromEntries(
      Object.entries(extracted.sourceToChapterIds).map(([sourceId, copiedId]) => [
        sourceId,
        merged.idMap[copiedId]
      ])
    )
  };
}

/** The material as a new chapter (the same ids as copied), after the repertoire's last chapter. */
function newChapterDraft(
  record: RepertoireRecord,
  input: AddFromGameInput,
  extracted: ExtractedScope,
  { kind, incomingMeta }: { kind: ChapterKind; incomingMeta: RepertoireChapter["nodeMeta"] }
): Draft {
  const headers = sanitizeHeaders(input.source.headers);
  const title = input.destination.kind === "new-chapter" ? input.destination.title : "";
  return {
    draft: {
      id: nanoid(),
      title: chapterTitle(title, gameTitle(headers)),
      sortOrder: chapterRepository.maxSortOrder(record.id) + 1,
      kind,
      enabled: true,
      rootFen: extracted.rootFen,
      revision: 0,
      nodeCount: extracted.tree.length - 1,
      dueCount: 0,
      headers,
      tree: extracted.tree,
      nodeMeta: incomingMeta
    },
    alreadyPresent: 0,
    chapterIds: extracted.sourceToChapterIds
  };
}

/**
 * How the chapter changes the repertoire's decisions: positions it gives a first decision
 * (`decisionsAdded`), and accepted moves where a stored decision accepts others (`conflicts`).
 */
function decisionImpact(
  record: RepertoireRecord,
  chapter: RepertoireChapter,
  extracted: ExtractedScope
): Pick<AddFromGamePreview, "decisionsAdded" | "conflicts"> {
  const chapters = chapterRepository.list(record.id);
  const before = collectDecisions(record.color, chapters);
  const after = collectDecisions(record.color, [
    ...chapters.filter((item) => item.id !== chapter.id),
    chapter
  ]);
  const stored = new Map(
    decisionRepository.list(record.id).map((decision) => [decision.positionKey, decision])
  );
  const lookup = buildChapterLookup(chapter);
  const conflicts: AddFromGamePreview["conflicts"] = [];
  let decisionsAdded = 0;
  for (const [key, entry] of after) {
    // A stored decision that regains support (suspended before) is not a new one.
    if (!before.has(key) && !stored.has(key)) decisionsAdded += 1;
    const decision = stored.get(key);
    if (!decision) continue;
    const effective = effectiveAcceptedUcis(decision, before.get(key)?.acceptedUcis ?? new Set());
    if (!effective.length) continue;
    for (const uci of entry.acceptedUcis) {
      // A stored accepted move that is merely supported again isn't a difference.
      if (decision.acceptedUcis.includes(uci)) continue;
      conflicts.push({
        positionKey: key,
        fen: entry.fen,
        existingUcis: effective,
        preferredUci: decision.preferredUci,
        newUci: uci,
        newSan: sanInChapter(lookup, key, uci),
        path: pathToPosition(extracted, key) ?? ""
      });
    }
  }
  return { decisionsAdded, conflicts };
}

/** Copied positions the repertoire's other chapters already reach (transpositions). */
function transpositionCount(
  record: RepertoireRecord,
  chapter: RepertoireChapter,
  extracted: ExtractedScope
): number {
  const indexed = new Set(
    positionIndexRepository
      .list(record.id)
      .filter((row) => row.chapterId !== chapter.id)
      .map((row) => row.positionKey)
  );
  const copiedKeys = new Set(
    extracted.tree
      .filter((node) => node.id !== REPERTOIRE_ROOT_NODE_ID)
      .map((node) => positionKey(node.fenAfter))
  );
  return [...copiedKeys].filter((key) => indexed.has(key)).length;
}

/** The warnings of an add: what will (not) be trained, and moves added beside existing choices. */
function addWarnings(input: {
  scope: AddFromGameScope;
  kind: ChapterKind;
  policy: AddFromGamePolicy;
  untrained: { trained: number; warnings: string[] };
  conflicts: AddFromGamePreview["conflicts"];
}): string[] {
  const { scope, kind, policy, untrained, conflicts } = input;
  const warnings: string[] = [];
  if (scope.kind === "whole-game" && !untrained.trained && !policy.includedNodeIds.length) {
    warnings.push("Whole game added as reference: nothing will be trained until you accept moves");
  } else if (kind === "reference" && policy.includedNodeIds.length) {
    warnings.push("Reference chapters never train: the chosen moves are kept as study material");
  } else if (!policy.includedNodeIds.length) {
    warnings.push("No moves are accepted: nothing from this material will be trained");
  } else if (!untrained.trained) {
    warnings.push("None of the chosen moves will be trained: nothing from this material is asked");
  }
  warnings.push(...untrained.warnings);
  if (conflicts.length) {
    const positions = new Set(conflicts.map((conflict) => conflict.positionKey)).size;
    warnings.push(
      `${positions} position${positions === 1 ? " already has" : "s already have"} another repertoire move: the new move is added as an alternative and your preferred move stays`
    );
  }
  return warnings;
}

/** The game node the link points at: the source's own when it is in the tree, else the scope's. */
function linkedGameNodeId(input: AddFromGameInput, sourceTree: readonly MoveNode[]): string | null {
  const { scope } = input;
  const scopeNodeId =
    scope.kind === "path" ? scope.toNodeId : scope.kind === "subtree" ? scope.fromNodeId : null;
  const nodeId = input.source.nodeId;
  return nodeId !== null && sourceTree.some((node) => node.id === nodeId) ? nodeId : scopeNodeId;
}

/**
 * Everything adding from a game needs, computed without writing: the validated source, the
 * extracted material, the would-be chapter (new, or merged into the destination), and the preview
 * figures measured against the repertoire's current chapters and decisions.
 */
function planAddFromGame(
  record: RepertoireRecord,
  input: AddFromGameInput,
  now: number
): AddFromGamePlan {
  const { scope } = input;
  if (input.source.gameId !== null && !libraryGameExists(input.source.gameId)) {
    throw new Error("Invalid source gameId: the game is not in the library");
  }
  const source = validateSourceTree(input.source);
  const extracted = extractScope(source, scope);
  const { existing, kind } = destinationOf(record, input.destination, now);

  const defaultPolicy = proposePolicy(record.color, extracted, scope, kind);
  const policy: AddFromGamePolicy = {
    includedNodeIds: [...new Set((input.policy ?? defaultPolicy).includedNodeIds)],
    coveredNodeIds: [...new Set((input.policy ?? defaultPolicy).coveredNodeIds)]
  };
  checkPolicy(record.color, extracted, policy);
  const { draft, alreadyPresent, chapterIds } = existing
    ? mergedDraft(record, existing, extracted, policy)
    : newChapterDraft(record, input, extracted, {
        kind,
        incomingMeta: applyPolicy(extracted, policy)
      });
  const chapter = sanitizeChapter(draft, (existing?.revision ?? 0) + 1);

  // Figures against the current repertoire.
  const { decisionsAdded, conflicts } = decisionImpact(record, chapter, extracted);

  // Which chosen moves the stored chapter will actually ask (§7.1).
  const ownMoves = listOwnMoves(record.color, extracted);
  const chosen = new Set(policy.includedNodeIds);
  const untrained =
    kind === "opening"
      ? untrainedMoveWarnings(
          chapter,
          ownMoves.flatMap((move) => {
            const chapterNodeId = chapterIds[move.nodeId];
            return chosen.has(move.nodeId) && chapterNodeId !== undefined
              ? [{ chapterNodeId, san: move.san, path: move.path }]
              : [];
          })
        )
      : { trained: 0, warnings: [] };

  return {
    chapter,
    linkHeaders: sanitizeHeaders(input.source.headers),
    gameNodeId: linkedGameNodeId(input, source.tree),
    capturedPath: formatPath(capturedRoute(source.tree, scope)),
    preview: {
      chapterTitle: chapter.title,
      nodeCount: extracted.tree.length - 1,
      decisionsAdded,
      conflicts,
      transpositions: transpositionCount(record, chapter, extracted),
      alreadyPresent,
      defaultPolicy,
      ownMoves,
      opponentMoves: listOpponentMoves(record.color, extracted),
      warnings: addWarnings({ scope, kind, policy, untrained, conflicts })
    }
  };
}

/**
 * What adding part of a game would do (§6.2), without writing anything: the chapter title, copied
 * move count, decisions gained, conflicts with existing decisions, transpositions, moves already in
 * an existing destination chapter, the default policy, the own-side move candidates and warnings.
 * The source tree is replayed and checked like a saved chapter. A null policy previews the
 * proposed defaults.
 */
export function previewAddFromGame(input: AddFromGameInput): AddFromGamePreview {
  const now = clock();
  return transaction(
    () => planAddFromGame(requireRepertoire(input.repertoireId), input, now),
    "read"
  ).preview;
}

/**
 * Copies the selected material into a new chapter, or merges it into an existing one, with the
 * confirmed policy; reconciles decisions, index and progress like saveChapter; and records a
 * `source` provenance link — all in one transaction. A move accepted where the repertoire already
 * decided another one is added as an accepted alternative; the stored preference is unchanged.
 * The policy must be explicit: a null policy is refused.
 */
export function addFromGame(input: AddFromGameInput): AddFromGameResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    if (input.policy === null) {
      throw new Error("Invalid policy: choose which moves to accept before adding");
    }
    const plan = planAddFromGame(record, input, now);
    const next = bump(record, now);
    chapterRepository.upsert(record.id, plan.chapter, now);
    const { decisionsChanged } = reindex(next, now);
    const link: RepertoireGameLink = {
      id: nanoid(),
      repertoireId: record.id,
      chapterId: plan.chapter.id,
      gameId: input.source.gameId,
      unsaved: input.source.gameId === null,
      gameNodeId: plan.gameNodeId,
      kind: "source",
      headers: plan.linkHeaders,
      capturedPath: plan.capturedPath,
      createdAt: now
    };
    gameLinkRepository.insert(link);
    return {
      repertoire: detail(record.id, now),
      chapter: loadChapter(record.id, plan.chapter.id, now),
      decisionsChanged,
      link
    };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

/** PGN tag names for the saved game's header fields (orientationHint is not a tag). */
const PGN_TAGS: ReadonlyArray<readonly [keyof GameHeaders, string]> = [
  ["event", "Event"],
  ["site", "Site"],
  ["date", "Date"],
  ["round", "Round"],
  ["white", "White"],
  ["black", "Black"],
  ["whiteElo", "WhiteElo"],
  ["blackElo", "BlackElo"],
  ["timeControl", "TimeControl"],
  ["eco", "ECO"],
  ["opening", "Opening"],
  ["utcDate", "UTCDate"],
  ["utcTime", "UTCTime"],
  ["termination", "Termination"],
  ["result", "Result"]
];

/** A saved game's headers as PGN tags (empty values dropped). */
function headerTags(headers: GameHeaders): Record<string, string> {
  const tags: Record<string, string> = {};
  for (const [field, tag] of PGN_TAGS) {
    const value = headers[field];
    if (typeof value === "string" && value) tags[tag] = value;
  }
  return sanitizeHeaders(tags);
}

/** An existing link re-pointed at `target`, with the game's current headers, where they changed. */
function refreshedLink(
  existing: RepertoireGameLink,
  target: Pick<RepertoireGameLink, "chapterId" | "gameNodeId" | "capturedPath">,
  tags: Record<string, string>
): RepertoireGameLink {
  const sameTarget =
    existing.chapterId === target.chapterId &&
    existing.gameNodeId === target.gameNodeId &&
    existing.capturedPath === target.capturedPath;
  const sameHeaders = JSON.stringify(existing.headers) === JSON.stringify(tags);
  if (sameTarget && sameHeaders) return existing;
  if (!sameTarget) gameLinkRepository.updateTarget(existing.id, target);
  if (!sameHeaders) gameLinkRepository.updateHeaders(existing.id, tags);
  return { ...existing, ...target, headers: tags };
}

/**
 * Links a library game to the repertoire as a `model` (attached for study) or a `played` game
 * (started from the repertoire). Idempotent per repertoire, game and kind: an existing link is
 * returned, re-pointed at the given chapter/node/path when those differ and with its headers
 * copied again from the game when they changed (a played game that has since finished). No
 * revision bump (the repertoire's content is unchanged), but listeners are told it was updated.
 */
export function linkGame(input: LinkGameInput): RepertoireGameLink {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    if (
      input.chapterId !== null &&
      chapterRepository.ownerOf(input.chapterId)?.repertoireId !== record.id
    ) {
      throw new Error(CHAPTER_NOT_FOUND_ERROR);
    }
    const headers = libraryGameExists(input.gameId)
      ? gameRepository.getHeaders(input.gameId)
      : null;
    if (!headers) throw new Error("Invalid gameId: the game is not in the library");
    const tags = headerTags(headers);

    const target = {
      chapterId: input.chapterId,
      gameNodeId: input.gameNodeId,
      capturedPath: input.capturedPath
    };
    const existing = gameLinkRepository.find(record.id, input.gameId, input.kind);
    if (existing) return { link: refreshedLink(existing, target, tags), revision: record.revision };
    const link: RepertoireGameLink = {
      id: nanoid(),
      repertoireId: record.id,
      gameId: input.gameId,
      unsaved: false,
      kind: input.kind,
      headers: tags,
      createdAt: now,
      ...target
    };
    try {
      gameLinkRepository.insert(link);
    } catch (error) {
      // An unreleased build created migration 8 without 'played'; its databases still refuse it.
      if (input.kind === "played" && /CHECK constraint failed/.test(String(error))) {
        throw new Error(
          "Invalid kind: this database predates played links; reset the development database",
          { cause: error }
        );
      }
      throw error;
    }
    return { link, revision: record.revision };
  });
  changed({ repertoireId: input.repertoireId, revision: result.revision, kind: "updated" });
  return result.link;
}

/** Provenance links of a repertoire, or of one of its chapters, oldest first. */
export function listGameLinks(input: {
  repertoireId: string;
  chapterId?: string;
}): RepertoireGameLink[] {
  requireRepertoire(input.repertoireId);
  if (
    input.chapterId !== undefined &&
    chapterRepository.ownerOf(input.chapterId)?.repertoireId !== input.repertoireId
  ) {
    throw new Error(CHAPTER_NOT_FOUND_ERROR);
  }
  return gameLinkRepository.list(input.repertoireId, input.chapterId);
}

/** Removes one provenance link (the copied material stays); no revision bump. */
export function removeGameLink(input: { repertoireId: string; linkId: string }): void {
  requireRepertoire(input.repertoireId);
  const link = gameLinkRepository.get(input.linkId);
  if (!link || link.repertoireId !== input.repertoireId) {
    throw new Error("Invalid linkId: not found");
  }
  gameLinkRepository.remove(link.id);
}
