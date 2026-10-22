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

/**
 * Earlier defaults. Older builds saved the default model with the key, so one of these in a file
 * they wrote (no `modelChosen`) means "the default" rather than a choice: it follows the current
 * one. Saved by this build, it is the user's choice and stays.
 */
const EARLIER_DEFAULT_MODELS: ReadonlySet<string> = new Set(["anthropic/claude-sonnet-4.6"]);

type StoredConfig = {
  /** The user's own model; null follows the default (DEFAULT_COMMENTARY_MODEL). */
  model: string | null;
  encryptedApiKey: string | null;
};

/** The model to store: null when it is blank, invalid or the current default. */
function storedModel(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const model = value.trim();
  if (!model || model.length > MAX_MODEL_LENGTH || /[\r\n\0]/.test(model)) return null;
  return model === DEFAULT_OPENROUTER_MODEL ? null : model;
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
      model: config.model ?? DEFAULT_OPENROUTER_MODEL,
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
    const model = input.model === undefined ? current.model : storedModel(input.model);
    let encryptedApiKey = current.encryptedApiKey;

    if (input.apiKey === null) {
      encryptedApiKey = null;
    } else if (typeof input.apiKey === "string" && input.apiKey.trim()) {
      encryptedApiKey = encryptSecret(this.secureStorage, input.apiKey.trim());
    }

    await this.write({ model, encryptedApiKey });
    return { model: model ?? DEFAULT_OPENROUTER_MODEL, hasApiKey: Boolean(encryptedApiKey) };
  }

  private async read(): Promise<StoredConfig> {
    const parsed = await readJsonObject(this.filePath);
    const model = storedModel(parsed?.model);
    return {
      model:
        model && parsed?.modelChosen !== true && EARLIER_DEFAULT_MODELS.has(model) ? null : model,
      encryptedApiKey:
        typeof parsed?.encryptedApiKey === "string" && parsed.encryptedApiKey.length > 0
          ? parsed.encryptedApiKey
          : null
    };
  }

  private write(config: StoredConfig): Promise<void> {
    // `modelChosen` marks a model this build saved as the user's (see EARLIER_DEFAULT_MODELS).
    return writePrivateJsonFile(this.filePath, { ...config, modelChosen: config.model !== null });
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
