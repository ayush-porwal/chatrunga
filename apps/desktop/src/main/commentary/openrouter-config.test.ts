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
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
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

  it("does not write a plaintext key when secure storage is unavailable", async () => {
    const path = await storePath();
    const store = new OpenRouterConfigStore(path, {
      isEncryptionAvailable: () => false,
      encryptString: (value) => Buffer.from(value),
      decryptString: (value) => value.toString()
    });

    await expect(store.set({ apiKey: "should-not-be-written" })).rejects.toThrow("Secure key storage");
    expect(await store.get()).toEqual({ model: "anthropic/claude-sonnet-4.6", hasApiKey: false });
  });
});
