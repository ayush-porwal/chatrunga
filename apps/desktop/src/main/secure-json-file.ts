import type { safeStorage } from "electron";
import { chmod, mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Helpers for small user-data JSON files that hold a secret (OpenRouter key, Lichess token): the
 * secret is encrypted with Electron safeStorage and the file is written atomically, readable only
 * by the user.
 *
 * On macOS every safeStorage call (even `isEncryptionAvailable`) reads the "Chaturanga Safe
 * Storage" keychain item and can raise the system keychain prompt, so callers only encrypt when a
 * secret is saved and decrypt when it is used — never just to report whether one exists.
 */

export type SecureStorageLike = Pick<
  typeof safeStorage,
  "isEncryptionAvailable" | "encryptString" | "decryptString"
>;

export const SECURE_STORAGE_UNAVAILABLE = "Secure key storage is unavailable on this system.";

/** Base64 ciphertext of `secret`. Throws rather than ever writing it in plain text. */
export function encryptSecret(storage: SecureStorageLike, secret: string): string {
  if (!storage.isEncryptionAvailable()) throw new Error(SECURE_STORAGE_UNAVAILABLE);
  return storage.encryptString(secret).toString("base64");
}

/** The secret, or null when there is none or it no longer decrypts (e.g. a copied profile). */
export function decryptSecret(storage: SecureStorageLike, encrypted: string | null): string | null {
  if (!encrypted || !storage.isEncryptionAvailable()) return null;
  try {
    return storage.decryptString(Buffer.from(encrypted, "base64")).trim() || null;
  } catch {
    return null;
  }
}

/** Parsed JSON object, or null when the file is missing or unreadable. */
export async function readJsonObject(filePath: string): Promise<Record<string, unknown> | null> {
  try {
    const parsed: unknown = JSON.parse(await readFile(filePath, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

let writeSeq = 0;

/** Writes through a temporary file renamed into place, so a crash never leaves half a file. */
export async function writePrivateJsonFile(filePath: string, value: unknown): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${filePath}.${process.pid}.${++writeSeq}.tmp`;
  try {
    await writeFile(temporaryPath, JSON.stringify(value), { encoding: "utf8", mode: 0o600 });
    await chmod(temporaryPath, 0o600);
    await rename(temporaryPath, filePath);
    await chmod(filePath, 0o600);
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined);
    throw error;
  }
}

/**
 * Runs read-modify-write steps one after another, so overlapping saves can't read the same old
 * file and overwrite each other's fields.
 */
export function createSerialQueue(): <T>(task: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(task: () => Promise<T>) => {
    const next = tail.then(task, task);
    tail = next.catch(() => undefined);
    return next;
  };
}
