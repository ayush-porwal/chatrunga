/**
 * Your picture (profile-pictures.ts), wired to the app: the copies live in
 * `<userData>/profile-pictures`, the accounts' pictures follow their stores (downloaded through a
 * session of their own), and a change is announced on `profile:pictureChanged`. Loaded in the
 * background as the IPC handlers are registered, before the window opens (register.ts): nothing
 * waits for it, and the main bundle doesn't carry it.
 */
import { app, session } from "electron";
import { join } from "node:path";
import type { YourPicture } from "@chaturanga/shared/ipc/chaturanga-api";
import type { PictureFile } from "@chaturanga/shared/types/pictures";
import { getChesscomAccountStore, getChesscomService } from "../chesscom";
import { allowImageFolder } from "../image-access";
import { broadcast } from "../ipc/broadcast";
import { getLichessAccountStore, getLichessService } from "../lichess";
import { errorMessage, logger } from "../logger";
import { pictureStore } from "../picture-store";
import { parseSavePictureInput, ProfilePictures } from "./profile-pictures";
import { downloadPicture, lichessFlairUrl } from "./remote-picture";

/**
 * The accounts' pictures are fetched by Chromium (system and PAC proxy settings apply) on an
 * in-memory session of their own: no cookies, cache or credentials of the app's windows go with
 * them, and none are kept.
 */
const DOWNLOAD_PARTITION = "profile-picture";

let pictures: ProfilePictures | null = null;

function profilePictures(): ProfilePictures {
  if (pictures) return pictures;
  const userData = app.getPath("userData");
  const warn = (message: string, error: unknown) =>
    logger.warn("profile-picture", `${message}:`, errorMessage(error));
  const store = pictureStore(join(userData, "profile-pictures"), { noun: "picture", warn });
  // The renderer loads the copies through the image protocol (index.ts).
  allowImageFolder(store.dir);
  pictures = new ProfilePictures({
    store,
    stateFile: join(userData, "profile-picture.json"),
    accountPictures: async () => {
      // The stores, not the services: reading them opens no connection and asks no keychain.
      const [chesscom, lichess] = await Promise.all([
        getChesscomAccountStore().account(),
        getLichessAccountStore().status()
      ]);
      const flair = lichess.account?.flair;
      return { chesscom: chesscom?.avatar ?? null, lichess: flair ? lichessFlairUrl(flair) : null };
    },
    download: (url) =>
      downloadPicture(url, {
        fetch: (input, init) => session.fromPartition(DOWNLOAD_PARTITION).fetch(input, init)
      }),
    onChange: () => broadcast("profile:pictureChanged", undefined),
    log: warn
  });
  return pictures;
}

/**
 * App open: your picture follows the accounts from now on (each account change brings their
 * pictures in step), starting with a check now. Never throws; nothing waits for it.
 */
export function startProfilePictures(): void {
  const refresh = (event: { type: string }) => {
    if (event.type === "status") void profilePictures().refresh();
  };
  getChesscomService().on("event", refresh);
  getLichessService().on("event", refresh);
  void profilePictures().refresh();
}

export function profilePicture(): Promise<YourPicture> {
  return profilePictures().picture();
}

/** The picture at `path` (picked in the open-file dialog; null when cancelled), to crop. */
export async function openProfilePicture(path: string | null): Promise<PictureFile | null> {
  return path ? profilePictures().open(path) : null;
}

export function originalProfilePicture(): Promise<PictureFile | null> {
  return profilePictures().original();
}

/** The renderer's crop (`input`, checked here) becomes your picture. */
export function saveProfilePicture(input: unknown): Promise<YourPicture> {
  return profilePictures().save(parseSavePictureInput(input));
}

export function removeProfilePicture(): Promise<YourPicture> {
  return profilePictures().remove();
}
