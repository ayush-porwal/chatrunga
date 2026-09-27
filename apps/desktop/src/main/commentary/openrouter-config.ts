import { app, safeStorage } from "electron";
import { join } from "node:path";
import type {
  OpenRouterConfigSummary,
  SetOpenRouterConfigInput
} from "@chaturanga/shared/ipc/chaturanga-api";
import { DEFAULT_COMMENTARY_MODEL as DEFAULT_OPENROUTER_MODEL } from "@chaturanga/shared/llm/models";
import {
  createSerialQueue,
  decryptSecret,
  encryptSecret,
  readJsonObject,
  writePrivateJsonFile,
  type SecureStorageLike
} from "../secure-json-file";

const MAX_MODEL_LENGTH = 160;

type StoredConfig = {
  model: string;
  encryptedApiKey: string | null;
};

function normalizeModel(value: unknown): string {
  if (typeof value !== "string") return DEFAULT_OPENROUTER_MODEL;
  const model = value.trim();
  if (!model || model.length > MAX_MODEL_LENGTH || /[\r\n\0]/.test(model)) {
    return DEFAULT_OPENROUTER_MODEL;
  }
  return model;
}

/**
 * Main-process-only OpenRouter configuration store.
 *
 * The API key is encrypted with Electron safeStorage before it is written to
 * the user-data directory. The renderer receives only `hasApiKey` and the
 * non-secret model id; `getApiKey()` is intentionally main-process-only.
 */
export class OpenRouterConfigStore {
  constructor(
    private readonly filePath: string,
    private readonly secureStorage: SecureStorageLike = safeStorage
  ) {}

  /**
   * The model and whether a key is saved. `hasApiKey` comes from the presence of the encrypted
   * blob, NOT from decrypting it: on macOS every safeStorage call (even `isEncryptionAvailable`)
   * reads the "Chaturanga Safe Storage" keychain item and can raise the system keychain prompt,
   * which must not happen just because Settings or Game review opened. The keychain is touched
   * only when a key is saved (`set`) or used for a request (`getApiKey`). A blob that no longer
   * decrypts (e.g. a profile copied from another computer) still reads as saved; the commentary
   * request then reports it (see UNREADABLE_API_KEY_ERROR).
   */
  async get(): Promise<OpenRouterConfigSummary> {
    const config = await this.read();
    return {
      model: normalizeModel(config.model),
      hasApiKey: Boolean(config.encryptedApiKey)
    };
  }

  /** Read the secret for a provider call. Never expose this through IPC. */
  async getApiKey(): Promise<string | null> {
    const config = await this.read();
    return decryptSecret(this.secureStorage, config.encryptedApiKey);
  }

  private readonly serialize = createSerialQueue();

  /**
   * Saves are serialized so overlapping calls (e.g. a model change and a key change) can't
   * read the same old config and overwrite each other's field.
   */
  set(input: SetOpenRouterConfigInput): Promise<OpenRouterConfigSummary> {
    return this.serialize(() => this.apply(input));
  }

  private async apply(input: SetOpenRouterConfigInput): Promise<OpenRouterConfigSummary> {
    const current = await this.read();
    const model = input.model === undefined ? normalizeModel(current.model) : normalizeModel(input.model);
    let encryptedApiKey = current.encryptedApiKey;

    if (input.apiKey === null) {
      encryptedApiKey = null;
    } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      encryptedApiKey = encryptSecret(this.secureStorage, input.apiKey.trim());
    }

    await this.write({ model, encryptedApiKey });
    return { model, hasApiKey: Boolean(encryptedApiKey) };
  }

  private async read(): Promise<StoredConfig> {
    const parsed = await readJsonObject(this.filePath);
    return {
      model: normalizeModel(parsed?.model),
      encryptedApiKey:
        typeof parsed?.encryptedApiKey === "string" && parsed.encryptedApiKey.length > 0
          ? parsed.encryptedApiKey
          : null
    };
  }

  private write(config: StoredConfig): Promise<void> {
    return writePrivateJsonFile(this.filePath, config);
  }
}

let store: OpenRouterConfigStore | null = null;

export function getOpenRouterConfigStore(): OpenRouterConfigStore {
  if (!store) {
    store = new OpenRouterConfigStore(
      join(app.getPath("userData"), "openrouter-config.json"),
      safeStorage
    );
  }
  return store;
}
