/**
 * Writes an imported book as a new repertoire: named after the book, its colour, one chapter per
 * book chapter (in book order), in one transaction with the full reconciliation every repertoire
 * write runs (decisions, position index, progress) and through the repertoire write gate. The
 * chapters pass the same checks as a chapter the renderer saves (sanitizeChapter). No tag marks it:
 * the books row linked to it does (`bookId` on its summary).
 */
import { nanoid } from "nanoid";
import { START_FEN } from "@chaturanga/shared/chess/position";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type {
  RepertoireChapter,
  RepertoireColor,
  RepertoireDetail,
  RepertoireNodeMeta
} from "@chaturanga/shared/types/repertoire";
import {
  chapterTitle,
  cleanName,
  cleanText,
  MAX_DESCRIPTION,
  sanitizeChapter
} from "../repertoire/chapter-validation";
import { detail, reindex, requireRepertoire } from "../repertoire/core";
import { chapterRepository, repertoireRepository, transaction } from "../repertoire/repository";
import { changed, clock, withRepertoireWriteGate } from "../repertoire/service-runtime";

type BookRepertoireChapter = {
  title: string;
  headers: Record<string, string>;
  tree: MoveNode[];
  nodeMeta: Record<string, RepertoireNodeMeta>;
};

export type BookRepertoireInput = {
  name: string;
  color: RepertoireColor;
  description: string;
  chapters: readonly BookRepertoireChapter[];
  /** Runs inside the same transaction once the repertoire is stored (links the book to it). */
  linkBook: (repertoireId: string, chapterIds: readonly string[]) => void;
  /**
   * The import's cancel: checked once the write's turn at the gate comes, so a write queued
   * behind other repertoire writes when its import was cancelled (or its book removed) never runs.
   */
  signal?: AbortSignal;
};

export type BookRepertoireResult = { repertoire: RepertoireDetail; chapterIds: string[] };

/**
 * Stores the book's repertoire; nothing is written when any chapter fails its checks, or when
 * `signal` aborted before its turn (rejecting with the abort's reason).
 */
export function writeBookRepertoire(input: BookRepertoireInput): Promise<BookRepertoireResult> {
  return withRepertoireWriteGate(() => {
    input.signal?.throwIfAborted();
    const now = clock();
    const id = nanoid();
    const chapters: RepertoireChapter[] = input.chapters.map((chapter, sortOrder) =>
      sanitizeChapter(
        {
          id: nanoid(),
          title: chapterTitle(chapter.title),
          sortOrder,
          kind: "opening",
          enabled: true,
          rootFen: START_FEN,
          revision: 1,
          nodeCount: chapter.tree.length - 1,
          dueCount: 0,
          headers: chapter.headers,
          tree: chapter.tree,
          nodeMeta: chapter.nodeMeta
        },
        1
      )
    );
    const result = transaction(() => {
      repertoireRepository.insert({
        id,
        name: cleanName(input.name),
        color: input.color,
        description: cleanText(input.description, MAX_DESCRIPTION) ?? "",
        tags: [],
        revision: 1,
        archivedAt: null,
        createdAt: now,
        updatedAt: now
      });
      for (const chapter of chapters) chapterRepository.upsert(id, chapter, now);
      reindex(requireRepertoire(id), now);
      const chapterIds = chapters.map((chapter) => chapter.id);
      input.linkBook(id, chapterIds);
      return { repertoire: detail(id, now), chapterIds };
    });
    changed({ repertoireId: id, revision: result.repertoire.revision, kind: "created" });
    return result;
  });
}
