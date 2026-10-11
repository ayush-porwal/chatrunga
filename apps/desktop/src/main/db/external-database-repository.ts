/** The installed puzzle databases' registry: which file each catalogued source was saved to. */
import { nanoid } from "nanoid";
import type {
  ExternalDatabaseFormat,
  ExternalDatabaseKind,
  ExternalDatabaseSource,
  InstalledDatabase
} from "@chaturanga/shared/types/database";
import { getDb } from "./index";
import { queriesOn } from "./rows";

type ExternalDatabaseRow = {
  id: string;
  source_id: string;
  name: string;
  provider: string;
  kind: ExternalDatabaseKind;
  format: ExternalDatabaseFormat;
  file_path: string;
  file_size_bytes: number;
  record_count: number | null;
  source_url: string;
  page_url: string;
  license: string;
  downloaded_at: number;
  updated_at: number;
};

const { all, get, run } = queriesOn(getDb);

function toInstalledDatabase(row: ExternalDatabaseRow): InstalledDatabase {
  return {
    id: row.id,
    sourceId: row.source_id,
    name: row.name,
    provider: row.provider,
    kind: row.kind,
    format: row.format,
    filePath: row.file_path,
    fileSizeBytes: row.file_size_bytes,
    recordCount: row.record_count,
    sourceUrl: row.source_url,
    pageUrl: row.page_url,
    license: row.license,
    downloadedAt: row.downloaded_at,
    updatedAt: row.updated_at
  };
}

export const externalDatabaseRepository = {
  list(): InstalledDatabase[] {
    return all<ExternalDatabaseRow>(
      "SELECT * FROM external_databases ORDER BY downloaded_at DESC"
    ).map(toInstalledDatabase);
  },

  get(id: string): InstalledDatabase | null {
    const row = get<ExternalDatabaseRow>("SELECT * FROM external_databases WHERE id = ?", id);
    return row ? toInstalledDatabase(row) : null;
  },

  getBySource(sourceId: string): InstalledDatabase | null {
    const row = get<ExternalDatabaseRow>(
      "SELECT * FROM external_databases WHERE source_id = ?",
      sourceId
    );
    return row ? toInstalledDatabase(row) : null;
  },

  saveDownloaded(input: {
    source: ExternalDatabaseSource;
    filePath: string;
    fileSizeBytes: number;
    recordCount?: number | null;
  }): InstalledDatabase {
    const timestamp = Date.now();
    const existing = this.getBySource(input.source.id);
    const id = existing?.id ?? nanoid();
    const downloadedAt = existing?.downloadedAt ?? timestamp;
    run(
      `INSERT INTO external_databases (
        id, source_id, name, provider, kind, format, file_path, file_size_bytes, record_count,
        source_url, page_url, license, downloaded_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(source_id) DO UPDATE SET
        name = excluded.name,
        provider = excluded.provider,
        kind = excluded.kind,
        format = excluded.format,
        file_path = excluded.file_path,
        file_size_bytes = excluded.file_size_bytes,
        record_count = excluded.record_count,
        source_url = excluded.source_url,
        page_url = excluded.page_url,
        license = excluded.license,
        updated_at = excluded.updated_at`,
      id,
      input.source.id,
      input.source.name,
      input.source.provider,
      input.source.kind,
      input.source.format,
      input.filePath,
      input.fileSizeBytes,
      input.recordCount ?? input.source.expectedRecords ?? null,
      input.source.url,
      input.source.pageUrl,
      input.source.license,
      downloadedAt,
      timestamp
    );
    const saved = this.get(id) ?? this.getBySource(input.source.id);
    if (!saved) throw new Error("Failed to save database metadata");
    return saved;
  },

  remove(id: string): void {
    run("DELETE FROM external_databases WHERE id = ?", id);
  },

  /** The file moved (see dataset-location.ts). */
  updateFilePath(id: string, filePath: string): void {
    run("UPDATE external_databases SET file_path = ? WHERE id = ?", filePath, id);
  }
};
