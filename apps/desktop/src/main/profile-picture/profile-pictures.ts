/**
 * Your picture (YourPicture): the photo you chose in Settings, else the connected Chess.com
 * account's picture, else the connected Lichess account's flair, else none. Each is a copy in the
 * app's picture folder (picture-store.ts), owned by its source ("upload", "chesscom", "lichess"),
 * so the renderer only ever loads local files. The accounts' pictures are downloaded when an
 * account connects or its picture's address changes, and deleted when it disconnects; a download
 * that fails leaves that source out (logged) and is tried again on the next change.
 */
import type { YourPicture } from "@chaturanga/shared/ipc/chaturanga-api";
import { isRecord } from "@chaturanga/shared/types/guards";
import { isFile, type PictureStore } from "../picture-store";
import { createSerialQueue, readJsonObject, writePrivateJsonFile } from "../secure-json-file";
import type { RemotePicture } from "./remote-picture";

type Source = NonNullable<YourPicture["source"]>;
type RemoteSource = Exclude<Source, "upload">;

/** In order of preference. */
const SOURCES: readonly Source[] = ["upload", "chesscom", "lichess"];
const REMOTE_SOURCES: readonly RemoteSource[] = ["chesscom", "lichess"];

/** A source's copy: its file, and (an account's) the address it was downloaded from. */
type Copy = { path: string; url: string | null };
type State = Record<Source, Copy | null>;

const NO_PICTURE: YourPicture = { src: null, source: null };

export type ProfilePicturesOptions = {
  store: PictureStore;
  /** Which copies are current (userData/profile-picture.json). */
  stateFile: string;
  /** The connected accounts' picture addresses (null: not connected, or no picture). */
  accountPictures: () => Promise<Record<RemoteSource, string | null>>;
  download: (url: string) => Promise<RemotePicture>;
  /** Your picture changed. */
  onChange: () => void;
  log: (message: string, error: unknown) => void;
};

/** The protocol URL the renderer loads a copy by (see security.ts `localImagePathFromUrl`). */
export function pictureSrc(path: string): string {
  return `chaturanga-image://local/${encodeURIComponent(path)}`;
}

export class ProfilePictures {
  /** Every change runs alone: a refresh's clean-up mustn't race a choice being stored. */
  private readonly serialize = createSerialQueue();
  /** A refresh waiting its turn: more account changes meanwhile join it. */
  private queuedRefresh: Promise<void> | null = null;

  constructor(private readonly options: ProfilePicturesOptions) {}

  async picture(): Promise<YourPicture> {
    return this.resolve(await this.read());
  }

  /** `path` (a file the user picked) becomes your picture; rejects when it can't be used. */
  choose(path: string): Promise<YourPicture> {
    return this.change(async (state) => {
      const copy = await this.options.store.adopt("upload", path);
      await this.options.store.prune("upload", copy);
      state.upload = { path: copy, url: null };
    });
  }

  /** Forgets the chosen photo. */
  remove(): Promise<YourPicture> {
    return this.change(async (state) => {
      await this.options.store.prune("upload", null);
      state.upload = null;
    });
  }

  /**
   * Brings the accounts' pictures in step with the accounts: downloads a picture for an account
   * that has a new (or not yet downloaded) one, deletes the copy of one that's gone. A download
   * that fails keeps the copy there was, under its old address, so the next refresh tries the new
   * one again. Never rejects.
   */
  refresh(): Promise<void> {
    this.queuedRefresh ??= this.serialize(async () => {
      this.queuedRefresh = null;
      const urls = await this.options.accountPictures();
      const state = await this.read();
      const before = await this.resolve(state);
      let changed = false;
      for (const source of REMOTE_SOURCES)
        changed = (await this.follow(state, source, urls[source])) || changed;
      if (changed) await this.write(state);
      if ((await this.resolve(state)).src !== before.src) this.options.onChange();
    }).catch((error: unknown) => this.options.log("refreshing your picture failed", error));
    return this.queuedRefresh;
  }

  /**
   * Brings `state`'s copy for an account in step with its picture's address (null: none, or no
   * account). Whether the state changed.
   */
  private async follow(state: State, source: RemoteSource, url: string | null): Promise<boolean> {
    const cached = state[source];
    const kept = cached && (await isFile(cached.path)) ? cached : null;
    if (kept && kept.url === url) return false;
    const next = url ? ((await this.downloaded(source, url)) ?? kept) : null;
    state[source] = next;
    await this.options.store.prune(source, next?.path ?? null);
    // The same picture at a new address is the same file: the address is still news.
    return cached?.path !== next?.path || cached?.url !== next?.url;
  }

  /** The account's picture at `url`, copied into the folder; null when it couldn't be. */
  private async downloaded(source: RemoteSource, url: string): Promise<Copy | null> {
    try {
      const picture = await this.options.download(url);
      return {
        path: await this.options.store.write(source, picture.contents, picture.extension),
        url
      };
    } catch (error) {
      this.options.log(`your ${source} picture wasn't downloaded`, error);
      return null;
    }
  }

  private change(apply: (state: State) => Promise<void>): Promise<YourPicture> {
    return this.serialize(async () => {
      const state = await this.read();
      await apply(state);
      await this.write(state);
      this.options.onChange();
      return this.resolve(state);
    });
  }

  /** The first source whose copy is there. */
  private async resolve(state: State): Promise<YourPicture> {
    for (const source of SOURCES) {
      const copy = state[source];
      if (copy && (await isFile(copy.path))) return { src: pictureSrc(copy.path), source };
    }
    return NO_PICTURE;
  }

  /** The state file, checked: only copies in the folder, each its source's. */
  private async read(): Promise<State> {
    const parsed = await readJsonObject(this.options.stateFile);
    const copy = (source: Source): Copy | null => {
      const value = parsed?.[source];
      if (!isRecord(value) || typeof value.path !== "string") return null;
      if (this.options.store.ownerOf(value.path) !== source) return null;
      return { path: value.path, url: typeof value.url === "string" ? value.url : null };
    };
    return { upload: copy("upload"), chesscom: copy("chesscom"), lichess: copy("lichess") };
  }

  private write(state: State): Promise<void> {
    return writePrivateJsonFile(this.options.stateFile, state);
  }
}
