import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenRouterConfigStore } from "./openrouter-config";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp" },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(`encrypted:${value}`),
    decryptString: (value: Buffer) => value.toString().replace(/^encrypted:/, "")
  }
}));

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true }))
  );
});

async function storePath(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "chaturanga-openrouter-"));
  temporaryDirectories.push(directory);
  return join(directory, "config.json");
}

describe("OpenRouterConfigStore", () => {
  it("stores the key encrypted and only exposes a boolean to callers", async () => {
    const path = await storePath();
    const store = new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`cipher:${value}`),
      decryptString: (value) => value.toString().replace(/^cipher:/, "")
    });

    const summary = await store.set({ model: "openai/test-model", apiKey: "unit-test-secret" });
    expect(summary).toEqual({ model: "openai/test-model", hasApiKey: true });
    expect(await store.get()).toEqual(summary);
    expect(await store.getApiKey()).toBe("unit-test-secret");

    const raw = await readFile(path, "utf8");
    expect(raw).not.toContain("unit-test-secret");
    expect(JSON.parse(raw)).toMatchObject({ encryptedApiKey: expect.any(String) });
  });

  it("keeps the existing key when the model is edited and removes it explicitly", async () => {
    const path = await storePath();
    const store = new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString()
    });

    await store.set({ apiKey: "first-secret", model: "model/one" });
    await store.set({ model: "model/two" });
    expect(await store.getApiKey()).toBe("first-secret");
    expect((await store.get()).model).toBe("model/two");

    expect(await store.set({ apiKey: null })).toMatchObject({ hasApiKey: false });
    expect(await store.getApiKey()).toBeNull();
  });

  it("keeps both fields when a model change and a key change overlap", async () => {
    const path = await storePath();
    const store = new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`cipher:${value}`),
      decryptString: (value) => value.toString().replace(/^cipher:/, "")
    });

    await Promise.all([
      store.set({ model: "anthropic/test-model" }),
      store.set({ apiKey: "overlapping-secret" })
    ]);
    expect(await store.get()).toEqual({ model: "anthropic/test-model", hasApiKey: true });
    expect(await store.getApiKey()).toBe("overlapping-secret");
  });

  it("does not write a plaintext key when secure storage is unavailable", async () => {
    const path = await storePath();
    const store = new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString()
    });

    await expect(store.set({ apiKey: "should-not-be-written" })).rejects.toThrow(
      "Secure key storage"
    );
    expect(await store.get()).toEqual({ model: "anthropic/claude-sonnet-4.6", hasApiKey: false });
  });

  it("reports a saved key without touching secure storage (no macOS keychain prompt)", async () => {
    const path = await storePath();
    const writer = new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(`cipher:${value}`),
      decryptString: (value) => value.toString().replace(/^cipher:/, "")
    });
    await writer.set({ apiKey: "keychain-test-secret" });

    // A fresh store, as after a restart: reading the summary must not decrypt or even ask.
    const secureStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(`cipher:${value}`)),
      decryptString: vi.fn((value: Buffer) => value.toString().replace(/^cipher:/, ""))
    };
    const reader = new OpenRouterConfigStore(path, secureStorage);
    expect(await reader.get()).toMatchObject({ hasApiKey: true });
    expect(await reader.set({ model: "model/changed" })).toMatchObject({
      hasApiKey: true,
      model: "model/changed"
    });
    expect(secureStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(secureStorage.decryptString).not.toHaveBeenCalled();
    expect(secureStorage.encryptString).not.toHaveBeenCalled();

    // Only an actual use of the key reads it.
    expect(await reader.getApiKey()).toBe("keychain-test-secret");
    expect(secureStorage.decryptString).toHaveBeenCalledTimes(1);
  });

  it("never touches secure storage when no key is saved", async () => {
    const secureStorage = {
      isEncryptionAvailable: vi.fn(() => true),
      encryptString: vi.fn((value: string) => Buffer.from(value)),
      decryptString: vi.fn((value: Buffer) => value.toString())
    };
    const store = new OpenRouterConfigStore(await storePath(), secureStorage);
    expect(await store.get()).toMatchObject({ hasApiKey: false });
    expect(await store.getApiKey()).toBeNull();
    expect(secureStorage.isEncryptionAvailable).not.toHaveBeenCalled();
    expect(secureStorage.decryptString).not.toHaveBeenCalled();
  });

  it("reads a key that no longer decrypts as saved, and as null when used", async () => {
    const path = await storePath();
    await new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString()
    }).set({ apiKey: "from-another-computer" });
    const store = new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => true,
      encryptString: (value) => Buffer.from(value),
      decryptString: () => {
        throw new Error("keychain access denied");
      }
    });
    expect(await store.get()).toMatchObject({ hasApiKey: true });
    expect(await store.getApiKey()).toBeNull();
  });
});
