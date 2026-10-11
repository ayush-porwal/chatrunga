/** Backup test material: chapters from UCI lines, and a seeded library to back up. */
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { MoveNode } from "@chaturanga/shared/types/chess";
import type { RepertoireChapter, RepertoireNodeMeta } from "@chaturanga/shared/types/repertoire";
import { fenAfterUci, START_FEN } from "@chaturanga/shared/chess/position";
import { positionKey } from "@chaturanga/shared/chess/repertoire-position";
import type * as Db from "../../db";
import type * as RepertoireService from "../service";
import { files, showSaveDialog } from "./backup-env";

/** A tree of UCI lines; white's moves are included and black's replies covered. */
export function chapterOf(id: string, lines: string[][]): RepertoireChapter {
  const root: MoveNode = {
    id: "root",
    parentId: null,
    san: null,
    uci: null,
    fenBefore: START_FEN,
    fenAfter: START_FEN,
    ply: 0,
    nags: [],
    comment: null,
    arrows: [],
    highlights: [],
    children: []
  };
  const tree = [root];
  const nodeMeta: Record<string, RepertoireNodeMeta> = {};
  for (const line of lines) {
    let parent = root;
    for (const uci of line) {
      let child = parent.children
        .map((childId) => tree.find((node) => node.id === childId)!)
        .find((node) => node.uci === uci);
      if (!child) {
        child = {
          ...root,
          id: `n${tree.length}`,
          parentId: parent.id,
          uci,
          san: uci,
          fenBefore: parent.fenAfter,
          fenAfter: fenAfterUci(parent.fenAfter, uci)!,
          ply: parent.ply + 1,
          children: []
        };
        nodeMeta[child.id] = { edge: child.ply % 2 === 1 ? "included" : "covered" };
        parent.children.push(child.id);
        tree.push(child);
      }
      parent = child;
    }
  }
  return {
    id,
    title: `Chapter ${id}`,
    sortOrder: 0,
    kind: "opening",
    enabled: true,
    rootFen: START_FEN,
    revision: 0,
    nodeCount: 0,
    dueCount: 0,
    headers: { Event: "Prep" },
    tree,
    nodeMeta
  };
}

/** The repertoire's one replace selection at `expectedRevision`. */
export function replaceSelection(
  sourceId: string,
  expectedRevision: number,
  includeProgress = true
) {
  return { sourceId, mode: "replace" as const, includeProgress, expectedRevision };
}

/** Library calls the backup tests share, on the test file's own (mocked) modules. */
export function backupHelpers(service: typeof RepertoireService, getDb: typeof Db.getDb) {
  const insertLibraryGame = (id: string) => {
    getDb()
      .prepare(
        `INSERT INTO games (id, source, pgn, current_fen, move_tree_json, created_at, updated_at)
            VALUES (?, 'pgn-import', '', ?, '[]', 1, 1)`
      )
      .run(id, START_FEN);
  };
  return {
    insertLibraryGame,
    /** A repertoire with two chapters, decisions, one progress row and two game links. */
    seed: () => {
      const created = service.createRepertoire({ name: "Open games", color: "white" });
      // An existing chapter is saved at its stored revision.
      const first = {
        ...chapterOf(created.chapters[0].id, [
          ["e2e4", "e7e5", "g1f3"],
          ["e2e4", "c7c5", "g1f3"]
        ]),
        revision: created.chapters[0].revision
      };
      const detail = service.saveChapter({
        repertoireId: created.id,
        chapter: first,
        expectedRevision: created.revision
      }).repertoire;
      service.saveChapter({
        repertoireId: created.id,
        chapter: { ...chapterOf("second", [["d2d4", "d7d5", "c2c4"]]), sortOrder: 1 },
        expectedRevision: detail.revision
      });
      const session = service.startPractice({ repertoireId: created.id, mode: "learn-new" });
      const card = session.cards[0];
      service.recordAttempt({
        sessionId: session.sessionId,
        queueItemId: card.queueItemId,
        attemptId: "a1",
        uci: card.positionKey === positionKey(START_FEN) ? "e2e4" : "g1f3"
      });
      insertLibraryGame("game-kept");
      insertLibraryGame("game-gone");
      service.linkGame({
        repertoireId: created.id,
        chapterId: first.id,
        gameId: "game-kept",
        gameNodeId: "g1",
        kind: "model",
        capturedPath: "1. e4"
      });
      service.linkGame({
        repertoireId: created.id,
        chapterId: "second",
        gameId: "game-gone",
        gameNodeId: null,
        kind: "played",
        capturedPath: "1. d4"
      });
      service.saveWorkspace({
        repertoireId: created.id,
        workspace: {
          lastChapterId: "second",
          lastNodeId: "n2",
          orientation: "white",
          practiceDraft: null
        }
      });
      // A finished session: practice history without one in progress (that would block a replace).
      service.endPractice(session.sessionId);
      return service.getRepertoire(created.id);
    },
    /** Exports through a mocked save dialog and returns the written text. */
    exportText: async (includeProgress: boolean, repertoireIds?: string[]) => {
      const path = join(files, `backup-${Math.random()}.json`);
      mkdirSync(files, { recursive: true });
      showSaveDialog.mockResolvedValueOnce({ canceled: false, filePath: path });
      const result = await service.exportBackup({ includeProgress, repertoireIds });
      return { result, text: readFileSync(path, "utf8"), path };
    }
  };
}
