/** Where the user was in each repertoire (chapter, node, orientation) and their practice setup. */
import type {
  RepertoireWorkspaceState,
  StartPracticeInput
} from "@chaturanga/shared/types/repertoire";
import { queriesOn } from "../db/rows";
import { asColor, parseJson } from "./columns";
import { repertoireDb } from "./connection";

const { get, run } = queriesOn(repertoireDb);

type WorkspaceRow = {
  repertoire_id: string;
  last_chapter_id: string | null;
  last_node_id: string | null;
  orientation: string;
  practice_draft_json: string | null;
  updated_at: number;
};

function toWorkspace(row: WorkspaceRow): RepertoireWorkspaceState {
  return {
    lastChapterId: row.last_chapter_id,
    lastNodeId: row.last_node_id,
    orientation: asColor(row.orientation),
    practiceDraft: parseJson<StartPracticeInput | null>(row.practice_draft_json, null)
  };
}

export const workspaceRepository = {
  get(repertoireId: string): RepertoireWorkspaceState | null {
    const row = get<WorkspaceRow>(
      "SELECT * FROM repertoire_workspace_state WHERE repertoire_id = ?",
      repertoireId
    );
    return row ? toWorkspace(row) : null;
  },

  /**
   * Stores the workspace. `studied` false (a practice-setup write) keeps the stored study time
   * (0 for a new row), which orders "Continue studying" and the last-studied date.
   */
  save(
    repertoireId: string,
    workspace: RepertoireWorkspaceState,
    now: number,
    studied = true
  ): void {
    run(
      `INSERT INTO repertoire_workspace_state (repertoire_id, last_chapter_id, last_node_id, orientation,
        practice_draft_json, updated_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(repertoire_id) DO UPDATE SET last_chapter_id = excluded.last_chapter_id,
        last_node_id = excluded.last_node_id, orientation = excluded.orientation,
        practice_draft_json = excluded.practice_draft_json,
        updated_at = CASE WHEN ? THEN excluded.updated_at ELSE repertoire_workspace_state.updated_at END`,
      repertoireId,
      workspace.lastChapterId,
      workspace.lastNodeId,
      workspace.orientation,
      workspace.practiceDraft ? JSON.stringify(workspace.practiceDraft) : null,
      studied ? now : 0,
      studied ? 1 : 0
    );
  }
};
