import { PICTURE_MAX_ZOOM, type PictureCrop } from "@chaturanga/shared/types/pictures";

/*
 * Your picture's crop (PictureCropDialog): a square cut from the original, as its centre (shares
 * of the width and height) and a zoom (the short side over the square's side). The square always
 * lies inside the picture, so the frame is always covered.
 */

export type ImageSize = { width: number; height: number };

/** The whole short side, centred. */
export const INITIAL_CROP: PictureCrop = { x: 0.5, y: 0.5, zoom: 1 };
/** A key's nudge in the frame's pixels (with Shift, the larger), and its zoom step. */
const NUDGE = 8;
const NUDGE_LARGE = 40;
const ZOOM_STEP = 0.25;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Number.isFinite(value) ? value : (min + max) / 2));

/** The square's side in the original's pixels. */
function side(size: ImageSize, zoom: number): number {
  return Math.min(size.width, size.height) / zoom;
}

/** `crop` within its bounds: the zoom between 1 and PICTURE_MAX_ZOOM, the square inside the picture. */
export function clampCrop(crop: PictureCrop, size: ImageSize): PictureCrop {
  const zoom = clamp(crop.zoom, 1, PICTURE_MAX_ZOOM);
  const half = side(size, zoom) / 2;
  return {
    x: clamp(crop.x, half / size.width, 1 - half / size.width),
    y: clamp(crop.y, half / size.height, 1 - half / size.height),
    zoom
  };
}

/** The square in the original's pixels: what is drawn into the saved picture. */
export function cropRect(
  crop: PictureCrop,
  size: ImageSize
): { x: number; y: number; size: number } {
  const bounded = clampCrop(crop, size);
  const length = side(size, bounded.zoom);
  return {
    x: clamp(bounded.x * size.width - length / 2, 0, size.width - length),
    y: clamp(bounded.y * size.height - length / 2, 0, size.height - length),
    size: length
  };
}

/** The picture and the frame it is cropped in: its size, and the frame's edge in CSS pixels. */
export type CropBox = { size: ImageSize; frame: number };

/** The picture dragged by (`dx`, `dy`) frame pixels: the square moves the other way. */
export function panCrop(
  crop: PictureCrop,
  { dx, dy }: { dx: number; dy: number },
  { size, frame }: CropBox
): PictureCrop {
  const perPixel = side(size, crop.zoom) / frame;
  return clampCrop(
    {
      ...crop,
      x: crop.x - (dx * perPixel) / size.width,
      y: crop.y - (dy * perPixel) / size.height
    },
    size
  );
}

/** Zoomed to `zoom` about the square's centre (kept inside the picture). */
export function zoomCrop(crop: PictureCrop, zoom: number, size: ImageSize): PictureCrop {
  return clampCrop({ ...crop, zoom }, size);
}

/** A wheel turn's zoom: smooth, larger for a larger turn (`deltaY` < 0 zooms in). */
export function wheelZoom(zoom: number, deltaY: number): number {
  return zoom * Math.exp(-deltaY / 500);
}

/**
 * The crop a key gives (null for any other key): the arrows move the picture as a drag would (by
 * NUDGE frame pixels, more with Shift), + and − zoom in and out.
 */
export function cropForKey(
  crop: PictureCrop,
  { key, shiftKey }: { key: string; shiftKey: boolean },
  box: CropBox
): PictureCrop | null {
  const step = shiftKey ? NUDGE_LARGE : NUDGE;
  switch (key) {
    case "ArrowLeft":
      return panCrop(crop, { dx: -step, dy: 0 }, box);
    case "ArrowRight":
      return panCrop(crop, { dx: step, dy: 0 }, box);
    case "ArrowUp":
      return panCrop(crop, { dx: 0, dy: -step }, box);
    case "ArrowDown":
      return panCrop(crop, { dx: 0, dy: step }, box);
    case "+":
    case "=":
      return zoomCrop(crop, crop.zoom + ZOOM_STEP, box.size);
    case "-":
    case "_":
      return zoomCrop(crop, crop.zoom - ZOOM_STEP, box.size);
    default:
      return null;
  }
}

/** Where the picture sits in a `frame`-pixel frame for `crop`: its shown size and offset. */
export function cropView(
  crop: PictureCrop,
  size: ImageSize,
  frame: number
): { width: number; height: number; left: number; top: number } {
  const rect = cropRect(crop, size);
  const scale = frame / rect.size;
  return {
    width: size.width * scale,
    height: size.height * scale,
    // `|| 0`: an edge at the frame's is 0, not −0.
    left: -rect.x * scale || 0,
    top: -rect.y * scale || 0
  };
}
