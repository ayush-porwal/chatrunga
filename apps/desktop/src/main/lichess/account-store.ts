import { unlink } from "node:fs/promises";
import type { LichessAccount, LichessPerf, LichessSpeed } from "@chaturanga/shared/types/lichess";
import {
  createSerialQueue,
  decryptSecret,
  encryptSecret,
  readJsonObject,
  writePrivateJsonFile,
  type SecureStorageLike
} from "../secure-json-file";

type StoredAccount = {
  account: LichessAccount | null;
  encryptedToken: string | null;
  tokenRejected: boolean;
  /**
   * `since` for the next games import: one past the last imported game's last move (epoch ms).
   * Kept apart from `account.lastSyncAt`, which is when the import ran (shown in the UI).
   */
  syncSince: number | null;
};

const EMPTY: StoredAccount = {
  account: null,
  encryptedToken: null,
  tokenRejected: false,
  syncSince: null
};

function finite(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readAccount(value: unknown): LichessAccount | null {
  if (!value || typeof value !== "object") return null;
  const json = value as Record<string, unknown>;
  if (typeof json.id !== "string" || !json.id || typeof json.username !== "string") return null;
  const perfs: LichessAccount["perfs"] = {};
  if (json.perfs && typeof json.perfs === "object") {
    for (const [key, perf] of Object.entries(json.perfs as Record<string, Partial<LichessPerf>>)) {
      if (typeof perf?.rating !== "number") continue;
      perfs[key as LichessSpeed] = {
        rating: perf.rating,
        games: finite(perf.games) ?? 0,
        provisional: perf.provisional === true
      };
    }
  }
  return {
    id: json.id,
    username: json.username,
    title: typeof json.title === "string" ? json.title : null,
    perfs,
    connectedAt: finite(json.connectedAt) ?? 0,
    lastSyncAt: finite(json.lastSyncAt)
  };
}

/**
 * The connected Lichess account and its OAuth token (userData/lichess-account.json), main
 * process only. The token is encrypted with safeStorage and never crosses IPC. `status()` reads
 * only the plain fields: it must not touch the keychain (see secure-json-file.ts), so opening a
 * screen that shows the account never raises the macOS keychain prompt.
 */
export class LichessAccountStore {
  private readonly serialize = createSerialQueue();

  constructor(
    private readonly filePath: string,
    private readonly secureStorage: SecureStorageLike
  ) {}

  async status(): Promise<{ account: LichessAccount | null; tokenRejected: boolean }> {
    const stored = await this.read();
    return {
      account: stored.account,
      tokenRejected: stored.account ? stored.tokenRejected : false
    };
  }

  /** Whether a token is saved and not known to be rejected (no decryption). */
  async hasUsableToken(): Promise<boolean> {
    const stored = await this.read();
    return Boolean(stored.account && stored.encryptedToken && !stored.tokenRejected);
  }

  /** The access token for a request. Never expose this through IPC. */
  async getToken(): Promise<string | null> {
    const stored = await this.read();
    if (!stored.account || stored.tokenRejected) return null;
    return decryptSecret(this.secureStorage, stored.encryptedToken);
  }

  async syncSince(): Promise<number | null> {
    return (await this.read()).syncSince;
  }

  /**
   * Saves a fresh sign-in. Reconnecting the same account keeps its import progress; another
   * account starts over.
   */
  save(account: LichessAccount, token: string): Promise<LichessAccount> {
    return this.serialize(async () => {
      const current = await this.read();
      const sameAccount = current.account?.id === account.id;
      const saved: LichessAccount = {
        ...account,
        lastSyncAt: sameAccount ? (current.account?.lastSyncAt ?? null) : null
      };
      await this.write({
        account: saved,
        encryptedToken: encryptSecret(this.secureStorage, token),
        tokenRejected: false,
        syncSince: sameAccount ? current.syncSince : null
      });
      return saved;
    });
  }

  /** Lichess answered 401: keep the account (for its name) but forget the token. */
  markTokenRejected(): Promise<void> {
    return this.serialize(async () => {
      const current = await this.read();
      if (!current.account) return;
      await this.write({ ...current, encryptedToken: null, tokenRejected: true });
    });
  }

  recordSync(lastSyncAt: number, syncSince: number | null): Promise<void> {
    return this.serialize(async () => {
      const current = await this.read();
      if (!current.account) return;
      await this.write({ ...current, account: { ...current.account, lastSyncAt }, syncSince });
    });
  }

  /** Forgets the account. Only a file that's already gone is fine: a credential left on disk must fail loudly. */
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
    return {
      account: readAccount(parsed.account),
      encryptedToken:
        typeof parsed.encryptedToken === "string" && parsed.encryptedToken
          ? parsed.encryptedToken
          : null,
      tokenRejected: parsed.tokenRejected === true,
      syncSince: finite(parsed.syncSince)
    };
  }

  private write(stored: StoredAccount): Promise<void> {
    return writePrivateJsonFile(this.filePath, stored);
  }
}
