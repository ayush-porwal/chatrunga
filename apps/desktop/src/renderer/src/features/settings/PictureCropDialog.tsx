import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type PointerEvent,
  type RefObject
} from "react";
import { Loader2, ZoomIn, ZoomOut } from "lucide-react";
import {
  PICTURE_MAX_ZOOM,
  PICTURE_OUTPUT_SIZE,
  type PictureCrop,
  type PictureFile
} from "@chaturanga/shared/types/pictures";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Notice } from "@/components/ui/notice";
import { cn } from "@/lib/utils";
import {
  clampCrop,
  cropForKey,
  cropRect,
  cropView,
  INITIAL_CROP,
  panCrop,
  wheelZoom,
  zoomCrop,
  type ImageSize
} from "./picture-crop";

/** The frame's edge in CSS pixels (size-64). */
const FRAME = 256;

/**
 * Crop your picture: the picture under a frame shaped as your picture shows (the avatar's rounded
 * square), dragged to position it (or the arrow keys), zoomed with the slider (or the wheel, a
 * pinch, + and −). Save draws the square at PICTURE_OUTPUT_SIZE and hands it to `onSave` with the
 * crop; `error` is why the last save failed. From Save until the save ends (drawing, then `saving`)
 * the dialog can't be closed: a save already under way would still apply after a Cancel.
 */
export function PictureCropDialog({
  file,
  saving,
  error,
  onCancel,
  onSave
}: {
  file: PictureFile;
  saving: boolean;
  error: string | null;
  onCancel: () => void;
  onSave: (cropped: Uint8Array, crop: PictureCrop) => void;
}) {
  const src = useDataUrl(file);
  const imageRef = useRef<HTMLImageElement>(null);
  const [size, setSize] = useState<ImageSize | null>(null);
  const [crop, setCrop] = useState<PictureCrop>(file.crop ?? INITIAL_CROP);
  const [drawError, setDrawError] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const busy = drawing || saving;

  const save = () => {
    const image = imageRef.current;
    if (!image || !size || busy) return;
    setDrawError(null);
    setDrawing(true);
    drawSquare(image, cropRect(crop, size))
      .then(
        (bytes) => onSave(bytes, clampCrop(crop, size)),
        () => setDrawError("Couldn’t draw the picture.")
      )
      .finally(() => setDrawing(false));
  };

  return (
    <Dialog
      size="sm"
      title="Crop your picture"
      description="Drag the picture or use the arrow keys; zoom with the slider."
      onClose={busy ? undefined : onCancel}
      footer={
        <>
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" variant="primary" size="sm" disabled={!size || busy} onClick={save}>
            {busy ? <Loader2 className="animate-spin" /> : null}
            Save
          </Button>
        </>
      }
    >
      <div className="grid justify-items-center gap-4">
        <CropFrame
          src={src}
          imageRef={imageRef}
          size={size}
          crop={crop}
          onLoad={(loaded) => {
            setSize(loaded);
            setCrop((current) => clampCrop(current, loaded));
          }}
          onCrop={setCrop}
        />
        <div className="flex w-64 items-center gap-2 text-fg-muted [&>svg]:size-4 [&>svg]:shrink-0">
          <ZoomOut aria-hidden />
          <input
            className="min-w-0 flex-1 cursor-pointer accent-accent disabled:cursor-not-allowed"
            type="range"
            min={1}
            max={PICTURE_MAX_ZOOM}
            step={0.01}
            value={crop.zoom}
            disabled={!size}
            aria-label="Zoom"
            onChange={(event) => {
              if (size) setCrop(zoomCrop(crop, Number(event.target.value), size));
            }}
          />
          <ZoomIn aria-hidden />
        </div>
        {(error ?? drawError) ? (
          <Notice tone="danger" className="w-full">
            {error ?? drawError}
          </Notice>
        ) : null}
      </div>
    </Dialog>
  );
}

/**
 * The frame: the picture placed for `crop`, its corners outside the avatar's shape dimmed. A drag
 * (pointer captured) moves it, the wheel and a trackpad pinch zoom, and, focused, the arrow keys
 * nudge it and + − zoom.
 */
function CropFrame({
  src,
  imageRef,
  size,
  crop,
  onLoad,
  onCrop
}: {
  src: string | null;
  imageRef: RefObject<HTMLImageElement | null>;
  size: ImageSize | null;
  crop: PictureCrop;
  onLoad: (size: ImageSize) => void;
  onCrop: (crop: PictureCrop) => void;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ x: number; y: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  // The latest crop for the wheel listener (registered once, not passive, so it can stop scrolling).
  const latest = useRef({ crop, size, onCrop });
  useEffect(() => {
    latest.current = { crop, size, onCrop };
  });
  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (event: WheelEvent) => {
      const { crop: current, size: loaded, onCrop: change } = latest.current;
      if (!loaded) return;
      event.preventDefault();
      change(zoomCrop(current, wheelZoom(current.zoom, event.deltaY), loaded));
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, []);

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!size || event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { x: event.clientX, y: event.clientY };
    setDragging(true);
  };
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from || !size) return;
    drag.current = { x: event.clientX, y: event.clientY };
    onCrop(
      panCrop(
        crop,
        { dx: event.clientX - from.x, dy: event.clientY - from.y },
        { size, frame: FRAME }
      )
    );
  };
  const endDrag = () => {
    drag.current = null;
    setDragging(false);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!size) return;
    const next = cropForKey(crop, event, { size, frame: FRAME });
    if (!next) return;
    event.preventDefault();
    onCrop(next);
  };

  const view = size ? cropView(crop, size, FRAME) : null;
  return (
    // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- a two-way control (role="application") with no native element: it takes drags and the arrow keys itself
    <div
      ref={frameRef}
      role="application"
      aria-roledescription="picture crop"
      aria-label="Picture position: drag, or use the arrow keys; + and − zoom"
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- focusable so the arrow keys can position the picture (see above)
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onKeyDown={onKeyDown}
      className={cn(
        "relative size-64 touch-none overflow-hidden rounded-lg bg-control outline-none select-none focus-visible:ring-2 focus-visible:ring-accent/70",
        size && (dragging ? "cursor-grabbing" : "cursor-grab")
      )}
    >
      {src ? (
        <img
          ref={imageRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={(event) =>
            onLoad({
              width: event.currentTarget.naturalWidth,
              height: event.currentTarget.naturalHeight
            })
          }
          className={cn("absolute max-w-none", !view && "invisible")}
          style={view ?? undefined}
        />
      ) : null}
      {/* The avatar's shape (25% rounding, as EngineAvatar's slots); what lies outside is dimmed. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 rounded-[25%] shadow-[0_0_0_200px_rgb(0_0_0/0.55)] ring-1 ring-white/60"
      />
    </div>
  );
}

/** `file`'s bytes as a data: URL (the app's CSP allows data: images, not blob:); null until read. */
function useDataUrl(file: PictureFile): string | null {
  const [read, setRead] = useState<{ file: PictureFile; url: string } | null>(null);
  useEffect(() => {
    let current = true;
    const reader = new FileReader();
    reader.onload = () => {
      if (current && typeof reader.result === "string") setRead({ file, url: reader.result });
    };
    reader.readAsDataURL(new Blob([new Uint8Array(file.bytes)], { type: file.type }));
    return () => {
      current = false;
      reader.abort();
    };
  }, [file]);
  return read?.file === file ? read.url : null;
}

/** The square `rect` of `image` drawn at PICTURE_OUTPUT_SIZE, as PNG bytes. */
async function drawSquare(
  image: HTMLImageElement,
  rect: { x: number; y: number; size: number }
): Promise<Uint8Array> {
  const canvas = document.createElement("canvas");
  canvas.width = PICTURE_OUTPUT_SIZE;
  canvas.height = PICTURE_OUTPUT_SIZE;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("No canvas");
  context.imageSmoothingQuality = "high";
  context.drawImage(
    image,
    rect.x,
    rect.y,
    rect.size,
    rect.size,
    0,
    0,
    PICTURE_OUTPUT_SIZE,
    PICTURE_OUTPUT_SIZE
  );
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob) throw new Error("No picture");
  return new Uint8Array(await blob.arrayBuffer());
}
