"use client";

import * as React from "react";
import { Crop } from "lucide-react";

import { useI18n } from "@/lib/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogActions,
  DialogBody,
  DialogIcon,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Square-crop step between picking a photo and staging it for upload.
 *
 * Hand-rolled on a canvas rather than a cropping library, for the reason the
 * rest of `components/ui` is hand-rolled: the interaction is a drag and a
 * scale, and a dependency for that would be larger than the code it replaces.
 *
 * The crop is applied to the bytes, not recorded as metadata — what leaves here
 * is a new square `File`, so the API stores an already-square photo and every
 * avatar in the app can keep using plain `object-cover`. Nothing downstream
 * needs to know a crop happened.
 */

/** Side of the square written back. Avatars render at 96px at the largest. */
const OUTPUT_SIZE = 512;
/** Side of the on-screen crop square. */
const VIEW = 288;
const MAX_ZOOM = 4;
const ZOOM_STEP = 0.0015;

export type CropSource = { file: File; bitmap: ImageBitmap };

/**
 * What to encode the result as.
 *
 * PNG and WEBP survive as themselves because a PNG may carry transparency that
 * JPEG would flatten onto black; everything else becomes JPEG, since re-encoding
 * a photograph as PNG multiplies its size for no gain. The extension always
 * matches the type — it is the key the API stores the file under.
 */
function outputFormat(file: File): { type: string; extension: string } {
  const name = file.name.toLowerCase();
  if (file.type === "image/png" || name.endsWith(".png"))
    return { type: "image/png", extension: ".png" };
  if (file.type === "image/webp" || name.endsWith(".webp"))
    return { type: "image/webp", extension: ".webp" };
  return { type: "image/jpeg", extension: ".jpg" };
}

function baseName(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot <= 0 ? name : name.slice(0, dot);
}

/**
 * Decode a picked file into a bitmap, or `null` if it is not really an image.
 *
 * `imageOrientation: "from-image"` is what applies the EXIF rotation a phone
 * writes instead of rotating the pixels. Without it a portrait photo crops
 * sideways here and then displays upright everywhere else, which reads as the
 * cropper being broken.
 *
 * This is also the only place a file's *contents* are checked: the name and the
 * type both come from the client, so a `.jpg` full of text passes every earlier
 * gate and fails here.
 */
export async function decodePhoto(file: File): Promise<ImageBitmap | null> {
  try {
    return await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    return null;
  }
}

/** How far the image may be dragged before an edge would leave the square. */
function clampOffset(value: number, drawn: number): number {
  return Math.min(0, Math.max(VIEW - drawn, value));
}

export function EmployeePhotoCrop({
  source,
  onCancel,
  onApply,
}: {
  source: CropSource;
  onCancel: () => void;
  onApply: (file: File) => void;
}) {
  const { t } = useI18n();
  const canvasRef = React.useRef<HTMLCanvasElement>(null);
  const frameRef = React.useRef<HTMLDivElement>(null);
  const dragRef = React.useRef<{ x: number; y: number } | null>(null);

  const { bitmap } = source;
  /** Scale at which the image exactly covers the square — the zoom floor. */
  const cover = Math.max(VIEW / bitmap.width, VIEW / bitmap.height);

  const [zoom, setZoom] = React.useState(1);
  const [offset, setOffset] = React.useState(() => ({
    x: (VIEW - bitmap.width * cover) / 2,
    y: (VIEW - bitmap.height * cover) / 2,
  }));
  const [busy, setBusy] = React.useState(false);

  const scale = cover * zoom;
  const drawnW = bitmap.width * scale;
  const drawnH = bitmap.height * scale;

  /* Preview. Backed at device resolution so the square is not a blurry
     approximation of the crop it is previewing. */
  React.useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = VIEW * dpr;
    canvas.height = VIEW * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, VIEW, VIEW);
    ctx.drawImage(bitmap, offset.x, offset.y, drawnW, drawnH);
  }, [bitmap, offset, drawnW, drawnH]);

  /**
   * Zoom about the centre of the square, so the subject under the crosshair
   * stays put. Zooming from the origin instead would walk the face out of frame.
   */
  const applyZoom = React.useCallback(
    (next: number) => {
      const clamped = Math.min(MAX_ZOOM, Math.max(1, next));
      setOffset((prev) => {
        const nextScale = cover * clamped;
        const centreX = (VIEW / 2 - prev.x) / scale;
        const centreY = (VIEW / 2 - prev.y) / scale;
        return {
          x: clampOffset(
            VIEW / 2 - centreX * nextScale,
            bitmap.width * nextScale
          ),
          y: clampOffset(
            VIEW / 2 - centreY * nextScale,
            bitmap.height * nextScale
          ),
        };
      });
      setZoom(clamped);
    },
    [bitmap.width, bitmap.height, cover, scale]
  );

  /* Wheel-to-zoom, attached by hand because React's onWheel is passive and so
     cannot stop the page behind the dialog scrolling with it. */
  React.useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      applyZoom(zoom - e.deltaY * ZOOM_STEP);
    };
    frame.addEventListener("wheel", onWheel, { passive: false });
    return () => frame.removeEventListener("wheel", onWheel);
  }, [applyZoom, zoom]);

  function onPointerDown(e: React.PointerEvent) {
    dragRef.current = { x: e.clientX, y: e.clientY };
    e.currentTarget.setPointerCapture(e.pointerId);
  }

  function onPointerMove(e: React.PointerEvent) {
    const from = dragRef.current;
    if (!from) return;
    const dx = e.clientX - from.x;
    const dy = e.clientY - from.y;
    dragRef.current = { x: e.clientX, y: e.clientY };
    setOffset((prev) => ({
      x: clampOffset(prev.x + dx, drawnW),
      y: clampOffset(prev.y + dy, drawnH),
    }));
  }

  function endDrag(e: React.PointerEvent) {
    dragRef.current = null;
    e.currentTarget.releasePointerCapture(e.pointerId);
  }

  async function apply() {
    setBusy(true);
    const { type, extension } = outputFormat(source.file);
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_SIZE;
    canvas.height = OUTPUT_SIZE;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      setBusy(false);
      onCancel();
      return;
    }
    // The preview is the crop, scaled: same offsets and same drawn size, times
    // the ratio between the two squares. Anything else would hand back a photo
    // framed differently from the one that was approved.
    const k = OUTPUT_SIZE / VIEW;
    ctx.drawImage(bitmap, offset.x * k, offset.y * k, drawnW * k, drawnH * k);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, type, 0.92)
    );
    setBusy(false);
    if (!blob) {
      onCancel();
      return;
    }
    onApply(
      new File([blob], `${baseName(source.file.name)}${extension}`, { type })
    );
  }

  return (
    <Dialog
      open
      onClose={onCancel}
      labelledBy="ef-crop-title"
      className="w-[min(380px,100%)]"
    >
      <DialogIcon>
        <Crop />
      </DialogIcon>
      <DialogTitle id="ef-crop-title">{t.efCropTitle}</DialogTitle>
      <DialogBody>{t.efCropHint}</DialogBody>

      <div
        ref={frameRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ width: VIEW, height: VIEW }}
        className="mt-5 max-w-full cursor-grab touch-none self-center overflow-hidden rounded-card bg-(--fill-subtle) shadow-[0_0_0_2px_var(--ring-avatar)] active:cursor-grabbing"
      >
        <canvas
          ref={canvasRef}
          style={{ width: VIEW, height: VIEW }}
          aria-label={t.efCropTitle}
        />
      </div>

      <label className="mt-4 flex items-center gap-3 text-xs text-(--text-tertiary)">
        {t.efCropZoom}
        <input
          type="range"
          min={1}
          max={MAX_ZOOM}
          step={0.01}
          value={zoom}
          onChange={(e) => applyZoom(Number(e.target.value))}
          className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-(--divider) accent-(--color-primary-bright)"
        />
      </label>

      <DialogActions>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          {t.btnCancel}
        </Button>
        <Button onClick={apply} disabled={busy}>
          {t.efCropApply}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
