import { unlink } from "node:fs/promises";
import {
  CHESSCOM_IMPORT_WINDOWS,
  CHESSCOM_RATING_KEYS,
  DEFAULT_CHESSCOM_IMPORT_WINDOW,
  type ChesscomAccount,
  type ChesscomImportWindow,
  type ChesscomRatings
} from "@chaturanga/shared/types/chesscom";
import { isOneOf, isRecord } from "@chaturanga/shared/types/guards";
import { createSerialQueue, readJsonObject, writePrivateJsonFile } from "../secure-json-file";
import type { ImportCursor } from "./game-import";

type StoredAccount = {
  account: ChesscomAccount | null;
  /** How far back the first import reaches (chosen when connecting). */
  firstImport: ChesscomImportWindow;
  /** Where the next import continues; null before the first one. */
  cursor: ImportCursor | null;
};

const EMPTY: StoredAccount = {
  account: null,
  firstImport: DEFAULT_CHESSCOM_IMPORT_WINDOW,
  cursor: null
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readRatings(value: unknown): ChesscomRatings {
  const ratings: ChesscomRatings = {};
  if (!isRecord(value)) return ratings;
  for (const key of CHESSCOM_RATING_KEYS) {
    const rating = finite(value[key]);
    if (rating !== null && rating > 0) ratings[key] = Math.round(rating);
  }
  return ratings;
}

function readAccount(value: unknown): ChesscomAccount | null {
  if (!isRecord(value)) return null;
  const { id, username } = value;
  if (typeof id !== "string" || !/^[a-z0-9_-]{1,50}$/.test(id)) return null;
  return {
    id,
    username: typeof username === "string" && username.toLowerCase() === id ? username : id,
    title: typeof value.title === "string" ? value.title : null,
    ratings: readRatings(value.ratings),
    connectedAt: finite(value.connectedAt) ?? 0,
    lastSyncAt: finite(value.lastSyncAt)
  };
}

function readCursor(value: unknown): ImportCursor | null {
  if (!isRecord(value) || typeof value.month !== "string") return null;
  if (!/^\d{4}\/(0[1-9]|1[0-2])$/.test(value.month)) return null;
  const floor = finite(value.floor);
  return floor === null || floor < 0 ? null : { month: value.month, floor };
}

/**
 * The connected chess.com account (userData/chesscom-account.json), main process only: the
 * username, its ratings, and how far the imports got. No password or token: chess.com's API is
 * public, so nothing in it is secret.
 */
export class ChesscomAccountStore {
  private readonly serialize = createSerialQueue();

  constructor(private readonly filePath: string) {}

  async account(): Promise<ChesscomAccount | null> {
    return (await this.read()).account;
  }

  /** What the next import needs: where it continues, or how far back the first one reaches. */
  async importState(): Promise<{
    firstImport: ChesscomImportWindow;
    cursor: ImportCursor | null;
  }> {
    const { firstImport, cursor } = await this.read();
    return { firstImport, cursor };
  }

  /**
   * Saves a connected account. Connecting the same account again keeps its import progress;
   * another account starts over.
   */
  save(account: ChesscomAccount, firstImport: ChesscomImportWindow): Promise<ChesscomAccount> {
    return this.serialize(async () => {
      const current = await this.read();
      const sameAccount = current.account?.id === account.id;
      const saved: ChesscomAccount = {
        ...account,
        lastSyncAt: sameAccount ? (current.account?.lastSyncAt ?? null) : null
      };
      await this.write({
        account: saved,
        firstImport: sameAccount ? current.firstImport : firstImport,
        cursor: sameAccount ? current.cursor : null
      });
      return saved;
    });
  }

  /** An import of `accountId` finished (ignored when another account is connected by now). */
  recordSync(accountId: string, lastSyncAt: number, cursor: ImportCursor | null): Promise<boolean> {
    return this.serialize(async () => {
      const current = await this.read();
      if (current.account?.id !== accountId) return false;
      await this.write({ ...current, account: { ...current.account, lastSyncAt }, cursor });
      return true;
    });
  }

  /** The account's ratings read again; null when it is no longer the one connected. */
  updateRatings(accountId: string, ratings: ChesscomRatings): Promise<ChesscomAccount | null> {
    return this.serialize(async () => {
      const current = await this.read();
      if (current.account?.id !== accountId) return null;
      const account = { ...current.account, ratings };
      await this.write({ ...current, account });
      return account;
    });
  }

  /** Forgets the account (a file already gone is fine). */
  clear(): Promise<void> {
    return this.serialize(() =>
      unlink(this.filePath).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      })
    );
  }

  private async read(): Promise<StoredAccount> {
    const parsed = await readJsonObject(this.filePath);
    if (!parsed) return EMPTY;
    const firstImport: unknown = parsed.firstImport;
    return {
      account: readAccount(parsed.account),
      firstImport: isOneOf(CHESSCOM_IMPORT_WINDOWS, firstImport)
        ? firstImport
        : DEFAULT_CHESSCOM_IMPORT_WINDOW,
      cursor: readCursor(parsed.cursor)
    };
  }

  private write(stored: StoredAccount): Promise<void> {
    return writePrivateJsonFile(this.filePath, stored);
  }
}
