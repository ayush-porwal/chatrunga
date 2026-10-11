/** Provenance links between repertoires and library games (design §6.2, §6.5). */
import type { RepertoireGameLink } from "@chaturanga/shared/types/repertoire";
import { queriesOn } from "../db/rows";
import { stringRecord } from "./columns";
import { repertoireDb } from "./connection";

const { all, get, run } = queriesOn(repertoireDb);

type GameLinkRow = {
  id: string;
  repertoire_id: string;
  chapter_id: string | null;
  game_id: string | null;
  unsaved: number;
  game_node_id: string | null;
  kind: string;
  headers_json: string;
  captured_path: string;
  created_at: number;
};

function toGameLink(row: GameLinkRow): RepertoireGameLink {
  return {
    id: row.id,
    repertoireId: row.repertoire_id,
    chapterId: row.chapter_id,
    gameId: row.game_id,
    unsaved: row.unsaved === 1,
    gameNodeId: row.game_node_id,
    kind: row.kind === "model" || row.kind === "played" ? row.kind : "source",
    headers: stringRecord(row.headers_json),
    capturedPath: row.captured_path,
    createdAt: row.created_at
  };
}

/** Provenance links (design §6.2, §6.5); a deleted game or chapter leaves a null reference. */
export const gameLinkRepository = {
  insert(link: RepertoireGameLink): void {
    run(
      `INSERT INTO repertoire_game_links (id, repertoire_id, chapter_id, game_id, unsaved, game_node_id,
        kind, headers_json, captured_path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      link.id,
      link.repertoireId,
      link.chapterId,
      link.gameId,
      link.unsaved ? 1 : 0,
      link.gameNodeId,
      link.kind,
      JSON.stringify(link.headers),
      link.capturedPath,
      link.createdAt
    );
  },

  get(id: string): RepertoireGameLink | null {
    const row = get<GameLinkRow>("SELECT * FROM repertoire_game_links WHERE id = ?", id);
    return row ? toGameLink(row) : null;
  },

  /** A repertoire's links (optionally one chapter's), oldest first. */
  list(repertoireId: string, chapterId?: string): RepertoireGameLink[] {
    const rows =
      chapterId === undefined
        ? all<GameLinkRow>(
            "SELECT * FROM repertoire_game_links WHERE repertoire_id = ? ORDER BY created_at, id",
            repertoireId
          )
        : all<GameLinkRow>(
            `SELECT * FROM repertoire_game_links WHERE repertoire_id = ? AND chapter_id = ?
              ORDER BY created_at, id`,
            repertoireId,
            chapterId
          );
    return rows.map(toGameLink);
  },

  /** The oldest link of this kind between the repertoire and the game, if any. */
  find(
    repertoireId: string,
    gameId: string,
    kind: RepertoireGameLink["kind"]
  ): RepertoireGameLink | null {
    const row = get<GameLinkRow>(
      `SELECT * FROM repertoire_game_links WHERE repertoire_id = ? AND game_id = ? AND kind = ?
        ORDER BY created_at, id LIMIT 1`,
      repertoireId,
      gameId,
      kind
    );
    return row ? toGameLink(row) : null;
  },

  /** Re-points a link at another chapter/node/path; headers and creation time stay. */
  updateTarget(
    id: string,
    target: Pick<RepertoireGameLink, "chapterId" | "gameNodeId" | "capturedPath">
  ): void {
    run(
      `UPDATE repertoire_game_links SET chapter_id = ?, game_node_id = ?, captured_path = ?
        WHERE id = ?`,
      target.chapterId,
      target.gameNodeId,
      target.capturedPath,
      id
    );
  },

  /** Replaces a link's copied headers (a played game that has since finished). */
  updateHeaders(id: string, headers: RepertoireGameLink["headers"]): void {
    run(
      "UPDATE repertoire_game_links SET headers_json = ? WHERE id = ?",
      JSON.stringify(headers),
      id
    );
  },

  remove(id: string): void {
    run("DELETE FROM repertoire_game_links WHERE id = ?", id);
  }
};

/** Whether the library has a game with this id (provenance links reference it). */
export function libraryGameExists(gameId: string): boolean {
  return get<{ id: string }>("SELECT id FROM games WHERE id = ?", gameId) !== null;
}
