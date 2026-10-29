/**
 * Edits of repertoires and their chapters (design §7): each in one transaction with its revision
 * check, reconciliation and change event.
 */
import { nanoid } from "nanoid";
import {
  CHAPTER_NOT_FOUND_ERROR,
  type ArchiveRepertoireInput,
  type ChapterSaveResult,
  type CreateRepertoireInput,
  type DuplicateRepertoireInput,
  type RemoveChapterInput,
  type RemoveRepertoireInput,
  type RepertoireChangeResult,
  type RepertoireDetail,
  type SaveChapterInput,
  type SaveWorkspaceInput,
  type UpdateChaptersInput,
  type UpdateChaptersResult,
  type UpdateRepertoireMetadataInput
} from "@chaturanga/shared/types/repertoire";
import { START_FEN } from "@chaturanga/shared/chess/position";
import { bump, checkRevision, detail, reindex, reindexChapter, requireRepertoire } from "./core";
import {
  chapterTitle,
  cleanName,
  cleanTags,
  cleanText,
  MAX_DESCRIPTION,
  isValidFen,
  rootNode,
  sanitizeChapter
} from "./chapter-validation";
import {
  chapterRepository,
  decisionRepository,
  repertoireRepository,
  transaction,
  type RepertoireRecord
} from "./repository";
import { workspaceRepository } from "./workspace-repository";
import { sessionRepository } from "./practice-repository";
import { changed, clock, loadChapter, storedChapter } from "./service-runtime";
import { withDetectedOpening } from "./chapter-openings";

/** A new repertoire with one chapter at `rootFen` (or the standard start). */
export function createRepertoire(input: CreateRepertoireInput): RepertoireDetail {
  const now = clock();
  const name = cleanName(input.name);
  const rootFen = input.rootFen?.trim() || START_FEN;
  if (!isValidFen(rootFen)) throw new Error("Invalid rootFen: not a legal position");
  const id = nanoid();
  const result = transaction(() => {
    repertoireRepository.insert({
      id,
      name,
      color: input.color,
      description: cleanText(input.description, MAX_DESCRIPTION) ?? "",
      tags: cleanTags(input.tags),
      revision: 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    });
    chapterRepository.upsert(
      id,
      withDetectedOpening({
        id: nanoid(),
        title: chapterTitle(input.firstChapterTitle, name),
        sortOrder: 0,
        kind: "opening",
        enabled: true,
        rootFen,
        revision: 1,
        nodeCount: 0,
        dueCount: 0,
        headers: {},
        tree: [rootNode(rootFen)],
        nodeMeta: {}
      }),
      now
    );
    reindex(requireRepertoire(id), now);
    return detail(id, now);
  });
  changed({ repertoireId: id, revision: result.revision, kind: "created" });
  return result;
}

export function updateMetadata(input: UpdateRepertoireMetadataInput): RepertoireDetail {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.id);
    checkRevision(record, input.expectedRevision);
    const patch: Partial<RepertoireRecord> = {};
    if (input.patch.name !== undefined) patch.name = cleanName(input.patch.name);
    if (input.patch.description !== undefined) {
      patch.description = cleanText(input.patch.description, MAX_DESCRIPTION) ?? "";
    }
    if (input.patch.tags !== undefined) patch.tags = cleanTags(input.patch.tags);
    bump(record, now, patch);
    return detail(record.id, now);
  });
  changed({ repertoireId: result.id, revision: result.revision, kind: "updated" });
  return result;
}

/**
 * Saves one chapter (new or existing) and reconciles decisions, index and progress
 * (reindexChapter: nothing for a change the index doesn't read, such as a comment; otherwise only
 * this chapter's rows and the positions it changed). An existing chapter must carry its stored
 * revision: another write (e.g. a decision change rewriting its edges) may have changed it since
 * the draft was loaded.
 */
export function saveChapter(input: SaveChapterInput): ChapterSaveResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    if (!input.chapter.id) {
      throw new Error("Invalid chapter: expected a chapter with an id");
    }
    const owner = chapterRepository.ownerOf(input.chapter.id);
    if (owner && owner.repertoireId !== record.id) {
      throw new Error("Invalid chapter: it belongs to another repertoire");
    }
    if (owner && input.chapter.revision !== owner.revision) {
      throw new Error(
        `Invalid chapter.revision: chapter changed (stored ${owner.revision}, expected ${input.chapter.revision})`
      );
    }
    const sanitized = sanitizeChapter(input.chapter, (owner?.revision ?? 0) + 1);
    const before = owner ? storedChapter(sanitized.id) : null;
    // The opening follows the mainline unless the user typed one (a save without the field
    // keeps the stored one's choice).
    const chapter = withDetectedOpening(
      sanitized.opening === undefined && before
        ? { ...sanitized, opening: before.opening }
        : sanitized
    );
    const next = bump(record, now);
    chapterRepository.upsert(record.id, chapter, now);
    const { decisionsChanged } =
      before === undefined ? reindex(next, now) : reindexChapter(next, before, chapter, now);
    return {
      repertoire: detail(record.id, now),
      chapter: loadChapter(record.id, chapter.id, now),
      decisionsChanged
    };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

export function removeChapter(input: RemoveChapterInput): RepertoireChangeResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    if (chapterRepository.ownerOf(input.chapterId)?.repertoireId !== record.id) {
      throw new Error(CHAPTER_NOT_FOUND_ERROR);
    }
    const before = storedChapter(input.chapterId);
    const next = bump(record, now);
    if (before === undefined) {
      chapterRepository.remove(input.chapterId);
      reindex(next, now);
    } else {
      // Before the row goes: removing it drops the chapter's index rows, which the update reads.
      reindexChapter(next, before, null, now);
      chapterRepository.remove(input.chapterId);
    }
    return { repertoire: detail(record.id, now) };
  });
  changed({
    repertoireId: input.repertoireId,
    revision: result.repertoire.revision,
    kind: "updated"
  });
  return result;
}

/**
 * Sets practice eligibility and/or kind on several chapters at once (the chapter list's bulk
 * actions): one revision check, one bump and one reconciliation in a single transaction, rather
 * than one chapter save per row. Chapters already in the requested state keep their revision; when
 * none changes, nothing is written and the repertoire keeps its revision too.
 */
export function updateChapters(input: UpdateChaptersInput): UpdateChaptersResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.repertoireId);
    checkRevision(record, input.expectedRevision);
    const stored = new Map(
      chapterRepository.summaries(record.id, now).map((chapter) => [chapter.id, chapter])
    );
    let chaptersChanged = 0;
    for (const chapterId of new Set(input.chapterIds)) {
      const chapter = stored.get(chapterId);
      if (!chapter) throw new Error("Invalid chapterIds: not found");
      const kind = input.patch.kind ?? chapter.kind;
      const enabled = input.patch.enabled ?? chapter.enabled;
      if (kind === chapter.kind && enabled === chapter.enabled) continue;
      chapterRepository.updateSettings(
        chapterId,
        { kind, enabled, revision: chapter.revision + 1 },
        now
      );
      chaptersChanged += 1;
    }
    if (chaptersChanged) reindex(bump(record, now), now);
    return { repertoire: detail(record.id, now), chaptersChanged };
  });
  if (result.chaptersChanged) {
    changed({
      repertoireId: input.repertoireId,
      revision: result.repertoire.revision,
      kind: "updated"
    });
  }
  return result;
}

/** A copy with fresh ids: chapters, decisions and workspace; progress starts fresh (§8.3). */
export function duplicateRepertoire(input: DuplicateRepertoireInput): RepertoireDetail {
  const now = clock();
  const id = nanoid();
  const result = transaction(() => {
    const source = requireRepertoire(input.id);
    const name = input.name?.trim() ? cleanName(input.name) : cleanName(`${source.name} (copy)`);
    repertoireRepository.insert({
      ...source,
      id,
      name,
      revision: 1,
      archivedAt: null,
      createdAt: now,
      updatedAt: now
    });
    const chapterIds = new Map<string, string>();
    for (const chapter of chapterRepository.list(source.id)) {
      const copyId = nanoid();
      chapterIds.set(chapter.id, copyId);
      chapterRepository.upsert(id, { ...chapter, id: copyId, revision: 1 }, now);
    }
    for (const decision of decisionRepository.list(source.id)) {
      decisionRepository.upsert({ ...decision, repertoireId: id }, now);
    }
    const workspace = workspaceRepository.get(source.id);
    if (workspace) {
      const lastChapterId = workspace.lastChapterId
        ? (chapterIds.get(workspace.lastChapterId) ?? null)
        : null;
      workspaceRepository.save(
        id,
        {
          ...workspace,
          lastChapterId,
          lastNodeId: lastChapterId ? workspace.lastNodeId : null,
          practiceDraft: null
        },
        now
      );
    }
    reindex(requireRepertoire(id), now);
    return detail(id, now);
  });
  changed({ repertoireId: id, revision: result.revision, kind: "created" });
  return result;
}

/** Archives or restores a repertoire (archived ones contribute no due cards). */
export function archiveRepertoire(input: ArchiveRepertoireInput): RepertoireChangeResult {
  const now = clock();
  const result = transaction(() => {
    const record = requireRepertoire(input.id);
    checkRevision(record, input.expectedRevision);
    if (input.archived) sessionRepository.moveSetSessions(record.id, false);
    bump(record, now, { archivedAt: input.archived ? (record.archivedAt ?? now) : null });
    return { repertoire: detail(record.id, now) };
  });
  changed({ repertoireId: input.id, revision: result.repertoire.revision, kind: "updated" });
  return result;
}

/** Deletes a repertoire and everything that belongs to it. */
export function removeRepertoire(input: RemoveRepertoireInput): void {
  const revision = transaction(() => {
    const record = requireRepertoire(input.id);
    checkRevision(record, input.expectedRevision);
    sessionRepository.moveSetSessions(record.id, true);
    repertoireRepository.remove(record.id);
    return record.revision + 1;
  });
  changed({ repertoireId: input.id, revision, kind: "removed" });
}

/**
 * Study preferences (last chapter/node, orientation, practice draft); no revision bump. A chapter
 * of another repertoire (or a deleted one) isn't kept as the place to continue, nor a node that
 * isn't in the chapter. Announced as a `workspace` change, since summaries show when it was last
 * studied and where to continue.
 */
export function saveWorkspace(input: SaveWorkspaceInput): void {
  const record = requireRepertoire(input.repertoireId);
  let { lastChapterId, lastNodeId } = input.workspace;
  if (
    lastChapterId !== null &&
    chapterRepository.ownerOf(lastChapterId)?.repertoireId !== record.id
  ) {
    lastChapterId = null;
  }
  if (lastChapterId === null) lastNodeId = null;
  else if (lastNodeId !== null) {
    const tree = chapterRepository.get(lastChapterId)?.tree ?? [];
    if (!tree.some((node) => node.id === lastNodeId)) lastNodeId = null;
  }
  workspaceRepository.save(
    record.id,
    { ...input.workspace, lastChapterId, lastNodeId },
    clock(),
    !input.practiceSetup
  );
  changed({ repertoireId: record.id, revision: record.revision, kind: "workspace" });
}
