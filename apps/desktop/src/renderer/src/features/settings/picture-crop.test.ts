import { describe, expect, it } from "vitest";
import { PICTURE_MAX_ZOOM } from "@chaturanga/shared/types/pictures";
import {
  clampCrop,
  cropForKey,
  cropRect,
  cropView,
  INITIAL_CROP,
  panCrop,
  wheelZoom,
  zoomCrop
} from "./picture-crop";

/** A landscape photo: the square's side is its height at zoom 1. */
const WIDE = { width: 1200, height: 800 };
const FRAME = 256;
const BOX = { size: WIDE, frame: FRAME };
const key = (name: string, shiftKey = false) => ({ key: name, shiftKey });

describe("picture crop", () => {
  it("starts on the whole short side, centred", () => {
    expect(cropRect(INITIAL_CROP, WIDE)).toStrictEqual({ x: 200, y: 0, size: 800 });
  });

  it("keeps the zoom between the whole short side and the most it zooms in", () => {
    expect(zoomCrop(INITIAL_CROP, 0.5, WIDE).zoom).toBe(1);
    expect(zoomCrop(INITIAL_CROP, 10, WIDE).zoom).toBe(PICTURE_MAX_ZOOM);
    expect(cropRect(zoomCrop(INITIAL_CROP, 2, WIDE), WIDE)).toStrictEqual({
      x: 400,
      y: 200,
      size: 400
    });
  });

  it("keeps the square inside the picture, so the frame is always covered", () => {
    const pushed = clampCrop({ x: 0, y: 1, zoom: 2 }, WIDE);
    expect(cropRect(pushed, WIDE)).toStrictEqual({ x: 0, y: 400, size: 400 });
    // At zoom 1 the short side can't move at all.
    expect(clampCrop({ x: 0.5, y: 0.1, zoom: 1 }, WIDE).y).toBe(0.5);
  });

  it("moves the square against a drag, a frame pixel being a pixel of the square's side", () => {
    // 800 px of the picture across 256 frame pixels: a 32 px drag right is 100 px left.
    const dragged = panCrop(INITIAL_CROP, { dx: 32, dy: 0 }, BOX);
    expect(cropRect(dragged, WIDE).x).toBeCloseTo(100);
    // Dragged past the edge: it stops there.
    expect(cropRect(panCrop(INITIAL_CROP, { dx: 1000, dy: 0 }, BOX), WIDE).x).toBe(0);
  });

  it("nudges with the arrow keys like a drag, further with Shift, and zooms with + and −", () => {
    const left = cropForKey(INITIAL_CROP, key("ArrowLeft"), BOX)!;
    expect(left.x).toBeGreaterThan(INITIAL_CROP.x);
    const far = cropForKey(INITIAL_CROP, key("ArrowLeft", true), BOX)!;
    expect(far.x).toBeGreaterThan(left.x);
    expect(cropForKey(INITIAL_CROP, key("+"), BOX)?.zoom).toBe(1.25);
    expect(cropForKey(INITIAL_CROP, key("-"), BOX)?.zoom).toBe(1);
    expect(cropForKey(INITIAL_CROP, key("Enter"), BOX)).toBeNull();
  });

  it("zooms in on a wheel turn up, out on one down", () => {
    expect(wheelZoom(2, -100)).toBeGreaterThan(2);
    expect(wheelZoom(2, 100)).toBeLessThan(2);
  });

  it("places the picture in the frame so the square fills it exactly", () => {
    expect(cropView(INITIAL_CROP, WIDE, FRAME)).toStrictEqual({
      width: 384,
      height: 256,
      left: -64,
      top: 0
    });
  });
});
