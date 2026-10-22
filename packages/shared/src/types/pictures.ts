import { isRecord } from "./guards";

/**
 * The picture files the open-file dialogs offer, for an engine's picture (Settings → Engines) and
 * for yours (Settings → Your picture): the types every one of them can show.
 */
export const PICTURE_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif", "svg"];

/** Your picture's files: the raster types it can be cropped from (a canvas draws them as they are). */
export const RASTER_PICTURE_FILE_EXTENSIONS = ["png", "jpg", "jpeg", "webp", "gif"];

/** The raster types a picture's bytes can hold (main/picture-bytes.ts reads them). */
export type RasterType = "image/png" | "image/jpeg" | "image/gif" | "image/webp";

/** Your picture is drawn this many pixels square from its crop. */
export const PICTURE_OUTPUT_SIZE = 512;
/** How far your picture's crop zooms in: from the whole short side (1) to a quarter of it. */
export const PICTURE_MAX_ZOOM = 4;

/**
 * Where your picture is cut from its original: the square's centre as a share of the original's
 * width (`x`) and height (`y`), and `zoom`, the original's short side over the square's side
 * (1: the square is as large as fits, up to PICTURE_MAX_ZOOM).
 */
export type PictureCrop = { x: number; y: number; zoom: number };

/** A picture file's bytes, for the renderer to crop (and the crop it was last cut with). */
export type PictureFile = { bytes: Uint8Array; type: RasterType; crop: PictureCrop | null };

/** Your picture as the renderer saves it (`profile.savePicture`). */
export type SavePictureInput = {
  /** The square PNG cut from the original (PICTURE_OUTPUT_SIZE at most). */
  cropped: Uint8Array;
  /** The original it was cut from; null when re-cut from the one already kept (Adjust). */
  original: Uint8Array | null;
  crop: PictureCrop;
};

/** Whether `value` is a crop within the bounds (an IPC payload checked before it's stored). */
export function isPictureCrop(value: unknown): value is PictureCrop {
  if (!isRecord(value)) return false;
  const { x, y, zoom } = value;
  const share = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0 && n <= 1;
  return (
    share(x) &&
    share(y) &&
    typeof zoom === "number" &&
    Number.isFinite(zoom) &&
    zoom >= 1 &&
    zoom <= PICTURE_MAX_ZOOM
  );
}
