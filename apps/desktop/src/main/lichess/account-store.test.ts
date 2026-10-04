import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LichessAccount } from "@chaturanga/shared/types/lichess";
import { LichessAccountStore } from "./account-store";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function storePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "chaturanga-lichess-"));
  temporaryDirectories.push(directory);
  return join(directory, "lichess-account.json");
}

function secureStorage() {
  return {
    isEncryptionAvailable: vi.fn(() => true),
    encryptString: vi.fn((value: string) => Buffer.from(`cipher:${value}`)),
    decryptString: vi.fn((value: Buffer) => value.toString().replace(/^cipher:/, ""))
  };
}

const ACCOUNT: LichessAccount = {
  id: "kenneth",
  username: "Kenneth",
  title: null,
  perfs: { rapid: { rating: 1500, games: 10, provisional: false } },
  connectedAt: 1000,
  lastSyncAt: null
};

describe("LichessAccountStore", () => {
  it("stores the token encrypted in a private file", async () => {
    const path = await storePath();
    const store = new LichessAccountStore(path, secureStorage());
    await store.save(ACCOUNT, "lip_test-token");
    expect(await store.getToken()).toBe("lip_test-token");
    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("lip_test-token");
    expect(JSON.parse(raw)).toMatchObject({
      account: { id: "kenneth" },
      encryptedToken: expect.any(String)
    });
    // oxlint-disable-next-line vitest/no-conditional-expect -- Windows has no POSIX file modes
    if (process.platform !== "win32") expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("reports the account without touching secure storage (no macOS keychain prompt)", async () => {
    const path = await storePath();
    await new LichessAccountStore(path, secureStorage()).save(ACCOUNT, "lip_test-token");

    const storage = secureStorage();
    const store = new LichessAccountStore(path, storage);
    expect(await store.status()).toEqual({ account: ACCOUNT, tokenRejected: false });
    expect(await store.hasUsableToken()).toBe(true);
    await store.recordSync(5000, 4001);
    expect(storage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(storage.decryptString).not.toHaveBeenCalled();
    expect(storage.encryptString).not.toHaveBeenCalled();

    expect(await store.getToken()).toBe("lip_test-token");
    expect(storage.decryptString).toHaveBeenCalledTimes(1);
  });

  it("keeps the account but drops the token when Lichess rejects it", async () => {
    const store = new LichessAccountStore(await storePath(), secureStorage());
    await store.save(ACCOUNT, "lip_test-token");
    await store.markTokenRejected();
    expect(await store.status()).toEqual({ account: ACCOUNT, tokenRejected: true });
    expect(await store.getToken()).toBeNull();
    expect(await store.hasUsableToken()).toBe(false);

    await store.save(ACCOUNT, "lip_new-token");
    expect(await store.status()).toMatchObject({ tokenRejected: false });
    expect(await store.getToken()).toBe("lip_new-token");
  });

  it("keeps import progress when the same account reconnects, not for another one", async () => {
    const store = new LichessAccountStore(await storePath(), secureStorage());
    await store.save(ACCOUNT, "t1");
    await store.recordSync(9000, 8001);
    await store.save({ ...ACCOUNT, connectedAt: 2000 }, "t2");
    expect((await store.status()).account).toMatchObject({ lastSyncAt: 9000, connectedAt: 2000 });
    expect(await store.syncSince()).toBe(8001);

    await store.save({ ...ACCOUNT, id: "salma", username: "Salma" }, "t3");
    expect((await store.status()).account).toMatchObject({ id: "salma", lastSyncAt: null });
    expect(await store.syncSince()).toBeNull();
  });

  it("forgets everything on clear, and never writes a plaintext token", async () => {
    const path = await storePath();
    const store = new LichessAccountStore(path, secureStorage());
    await store.save(ACCOUNT, "t1");
    await store.clear();
    expect(await store.status()).toEqual({ account: null, tokenRejected: false });
    await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });

    const unavailable = new LichessAccountStore(path, {
      ...secureStorage(),
      isEncryptionAvailable: () => false
    });
    await expect(unavailable.save(ACCOUNT, "plain")).rejects.toThrow(/Secure key storage/);
    expect(await unavailable.status()).toEqual({ account: null, tokenRejected: false });
  });

  it("fails when the credential can't be removed, but not when it's already gone", async () => {
    const path = await storePath();
    const store = new LichessAccountStore(path, secureStorage());
    await expect(store.clear()).resolves.toBeUndefined();
    // A directory in the file's place can't be unlinked like a file.
    const directoryPath = `${path}.dir`;
    await mkdir(directoryPath);
    await expect(new LichessAccountStore(directoryPath, secureStorage()).clear()).rejects.toMatchObject({ code: expect.stringMatching(/^(EISDIR|EPERM)$/) });
  });
});
