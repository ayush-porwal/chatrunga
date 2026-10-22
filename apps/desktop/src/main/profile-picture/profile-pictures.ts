/**
 * Your picture (YourPicture): the photo you chose in Settings, else the connected Chess.com
 * account's picture, else the connected Lichess account's flair, else none. Each is a copy in the
 * app's picture folder (picture-store.ts), owned by its source ("upload", "chesscom", "lichess"),
 * so the renderer only ever loads local files. Your photo is the square the renderer cropped; the
 * original it was cut from is kept beside it ("original") with the crop, so Adjust re-cuts from
 * the original rather than from a copy of a copy. The accounts' pictures are downloaded when an
 * account connects or its picture's address changes, and deleted when it disconnects; a download
 * that fails leaves that source out (logged) and is tried again on the next change.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, isAbsolute } from "node:path";
import type { YourPicture } from "@chaturanga/shared/ipc/chaturanga-api";
import { isRecord } from "@chaturanga/shared/types/guards";
import {
  isPictureCrop,
  PICTURE_OUTPUT_SIZE,
  type PictureCrop,
  type PictureFile,
  type SavePictureInput
} from "@chaturanga/shared/types/pictures";
import { pngSize, RASTER_EXTENSIONS, rasterType } from "../picture-bytes";
import { isFile, PICTURE_MAX_BYTES, type PictureStore } from "../picture-store";
import { createSerialQueue, readJsonObject, writePrivateJsonFile } from "../secure-json-file";
import type { RemotePicture } from "./remote-picture";

type Source = NonNullable<YourPicture["source"]>;
type RemoteSource = Exclude<Source, "upload">;

/** In order of preference. */
const SOURCES: readonly Source[] = ["upload", "chesscom", "lichess"];
const REMOTE_SOURCES: readonly RemoteSource[] = ["chesscom", "lichess"];

/** A source's copy: its file, and (an account's) the address it was downloaded from. */
type Copy = { path: string; url: string | null };
/** Every source's copy, and your photo's original (owned by "original") with its crop. */
type State = Record<Source | "original", Copy | null> & { crop: PictureCrop | null };
type Owner = Source | "original";
/** The copies your own choices change (the accounts' pictures change on refresh). */
const CHANGED_OWNERS: readonly Owner[] = ["upload", "original"];

const NO_PICTURE: YourPicture = { src: null, source: null, adjustable: false };
const NOT_A_PICTURE = "isn't a PNG, JPG, WebP or GIF file";

/** The renderer's crop (an IPC payload), checked: a square PNG, its original, the crop. */
export function parseSavePictureInput(value: unknown): {
  cropped: Buffer;
  original: Buffer | null;
  crop: PictureCrop;
} {
  const input: Partial<Record<keyof SavePictureInput, unknown>> = isRecord(value) ? value : {};
  const { cropped, original, crop } = input;
  if (!(cropped instanceof Uint8Array) || !isPictureCrop(crop)) throw new Error("Invalid picture.");
  if (original !== null && !(original instanceof Uint8Array)) throw new Error("Invalid picture.");
  return { cropped: squarePng(asBuffer(cropped)), original: originalPicture(original), crop };
}

/** The renderer's cropped square: a PNG at most PICTURE_OUTPUT_SIZE square, and 5 MB. */
function squarePng(bytes: Buffer): Buffer {
  const size = pngSize(bytes);
  if (!size || size.width !== size.height || !size.width || size.width > PICTURE_OUTPUT_SIZE)
    throw new Error("The cropped picture must be a square PNG.");
  return withinSize(bytes);
}

/** The original sent with a crop: a raster picture of at most 5 MB (null: the kept one). */
function originalPicture(bytes: Uint8Array | null): Buffer | null {
  if (!bytes) return null;
  const buffer = asBuffer(bytes);
  if (!rasterType(buffer)) throw new Error(`The picture ${NOT_A_PICTURE}.`);
  return withinSize(buffer);
}

function withinSize(bytes: Buffer): Buffer {
  if (bytes.length > PICTURE_MAX_BYTES) throw new Error("The picture is larger than 5 MB.");
  return bytes;
}

function asBuffer(bytes: Uint8Array): Buffer {
  return Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

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

  /**
   * Your picture once the changes under way are done: a refresh in flight (the one the app starts
   * with) is waited for, so the first read is already current, not the state before it.
   */
  picture(): Promise<YourPicture> {
    return this.serialize(async () => this.resolve(await this.read()));
  }

  /**
   * The picture at `path` (a file the user picked), to crop: a PNG, JPG, WebP or GIF of at most
   * 5 MB, by its bytes. Nothing is stored until the crop is saved.
   */
  async open(path: string): Promise<PictureFile> {
    if (!isAbsolute(path)) throw new Error("The picture must be a file on this computer.");
    const info = await stat(path).catch(() => null);
    if (!info?.isFile()) throw new Error(`The picture ${basename(path)} wasn't found.`);
    if (info.size > PICTURE_MAX_BYTES) throw new Error("The picture is larger than 5 MB.");
    const bytes = await readFile(path);
    // Again on what was read: the file may have grown (or been replaced) since its size was read.
    if (bytes.length > PICTURE_MAX_BYTES) throw new Error("The picture is larger than 5 MB.");
    const type = rasterType(bytes);
    if (!type) throw new Error(`The picture ${basename(path)} ${NOT_A_PICTURE}.`);
    return { bytes, type, crop: null };
  }

  /** Your photo's original and the crop it was cut with; null when none is kept. */
  original(): Promise<PictureFile | null> {
    return this.serialize(async () => {
      const state = await this.read();
      if (!(await this.adjustable(state)) || !state.original) return null;
      const bytes = await readFile(state.original.path);
      const type = rasterType(bytes);
      return type ? { bytes, type, crop: state.crop } : null;
    });
  }

  /**
   * `cropped` becomes your picture, cut with `crop` from `original` (null: the original already
   * kept, re-cut), which is kept beside it.
   */
  save({
    cropped,
    original,
    crop
  }: {
    cropped: Buffer;
    original: Buffer | null;
    crop: PictureCrop;
  }): Promise<YourPicture> {
    return this.change(async (state) => {
      const { store } = this.options;
      if (original) {
        const type = rasterType(original);
        if (!type) throw new Error(`The picture ${NOT_A_PICTURE}.`);
        state.original = {
          path: await store.write("original", original, RASTER_EXTENSIONS[type]),
          url: null
        };
      } else if (!state.original || !(await isFile(state.original.path))) {
        throw new Error("Choose the picture again: its original isn't kept.");
      }
      state.upload = { path: await store.write("upload", cropped, ".png"), url: null };
      state.crop = crop;
    });
  }

  /** Forgets the chosen photo, and its original. */
  remove(): Promise<YourPicture> {
    return this.change((state) => {
      state.upload = null;
      state.original = null;
      state.crop = null;
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
      const saved = { ...state };
      const before = await this.resolve(state);
      let changed = false;
      for (const source of REMOTE_SOURCES)
        changed = (await this.follow(state, source, urls[source])) || changed;
      if (changed) await this.commit(state, saved, REMOTE_SOURCES);
      if ((await this.resolve(state)).src !== before.src) this.options.onChange();
    }).catch((error: unknown) => this.options.log("refreshing your picture failed", error));
    return this.queuedRefresh;
  }

  /**
   * Brings `state`'s copy for an account in step with its picture's address (null: none, or no
   * account). Whether the state changed (the copies it no longer names go once it is saved).
   */
  private async follow(state: State, source: RemoteSource, url: string | null): Promise<boolean> {
    const cached = state[source];
    const kept = cached && (await isFile(cached.path)) ? cached : null;
    if (kept && kept.url === url) return false;
    const next = url ? ((await this.downloaded(source, url)) ?? kept) : null;
    state[source] = next;
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

  private change(apply: (state: State) => Promise<void> | void): Promise<YourPicture> {
    return this.serialize(async () => {
      const state = await this.read();
      const saved = { ...state };
      try {
        await apply(state);
      } catch (error) {
        // A change that failed part way (an original written, then its crop not) leaves no file
        // behind: what the saved state names stays, anything new goes.
        await this.pruneTo(saved, CHANGED_OWNERS);
        throw error;
      }
      await this.commit(state, saved, CHANGED_OWNERS);
      this.options.onChange();
      return this.resolve(state);
    });
  }

  /**
   * Stores `state` (changed from `saved` for `sources`), then deletes those sources' copies it no
   * longer names. The file goes first: were a copy deleted before, a failed write would leave the
   * state naming a file that's gone. When it can't be stored, the new copies go instead, and the
   * state and copies there were stay.
   */
  private async commit(state: State, saved: State, owners: readonly Owner[]): Promise<void> {
    try {
      await this.write(state);
    } catch (error) {
      await this.pruneTo(saved, owners);
      throw error;
    }
    await this.pruneTo(state, owners);
  }

  /** Deletes `owners`' copies that `state` doesn't name. */
  private async pruneTo(state: State, owners: readonly Owner[]): Promise<void> {
    await Promise.all(
      owners.map((owner) => this.options.store.prune(owner, state[owner]?.path ?? null))
    );
  }

  /** The first source whose copy is there. */
  private async resolve(state: State): Promise<YourPicture> {
    for (const source of SOURCES) {
      const copy = state[source];
      if (copy && (await isFile(copy.path)))
        return {
          src: pictureSrc(copy.path),
          source,
          adjustable: source === "upload" && (await this.adjustable(state))
        };
    }
    return NO_PICTURE;
  }

  /** Whether your photo's original is there to crop again. */
  private async adjustable(state: State): Promise<boolean> {
    return Boolean(state.upload && state.original && (await isFile(state.original.path)));
  }

  /** The state file, checked: only copies in the folder, each its source's. */
  private async read(): Promise<State> {
    const parsed = await readJsonObject(this.options.stateFile);
    const copy = (owner: Owner): Copy | null => {
      const value = parsed?.[owner];
      if (!isRecord(value) || typeof value.path !== "string") return null;
      if (this.options.store.ownerOf(value.path) !== owner) return null;
      return { path: value.path, url: typeof value.url === "string" ? value.url : null };
    };
    return {
      upload: copy("upload"),
      chesscom: copy("chesscom"),
      lichess: copy("lichess"),
      original: copy("original"),
      crop: isPictureCrop(parsed?.crop) ? parsed.crop : null
    };
  }

  private write(state: State): Promise<void> {
    return writePrivateJsonFile(this.options.stateFile, state);
  }
}
