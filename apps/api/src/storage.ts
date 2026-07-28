/**
 * Uploaded-file storage: sound clips (design D7) and employee photos (D8).
 *
 * The bytes live on the filesystem under a configured directory and are served
 * with `Bun.file`, which is a lazy handle: the file never enters this process's
 * heap, and after the first read the OS page cache serves it. Postgres `bytea`
 * was the alternative — it needs no volume and rides the database backup — but
 * every read would pull the whole blob across the connection and de-TOAST it
 * first, which for a clip several kiosks play on a schedule, or a photo on every
 * row of an employee list, is the whole decision.
 *
 * The cost is a directory that has to survive a redeploy. That is why each
 * location is explicit configuration and why `/health` reports on both: a
 * missing volume should surface at startup, not at the first upload.
 *
 * Everything below is parameterised by directory, with two thin sets of
 * wrappers over it. What differs between the two kinds is not the mechanism but
 * the policy — which extensions are kept, and how many bytes are too many — so
 * that is what the wrappers carry and nothing else.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { env } from "./env";

/** Small enough that a hostile file fails fast, ample for a bell or a siren. */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

/** A portrait, not a photograph of a machine — generous at this size. */
export const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

/** Extensions kept from a sound upload. Anything else stores without one. */
const SAFE_EXTENSIONS = new Set([
  ".wav",
  ".mp3",
  ".ogg",
  ".m4a",
  ".aac",
  ".flac",
  ".opus",
  ".webm",
]);

/**
 * Image extensions a photo may be stored under.
 *
 * Unlike the sound list this one is a gate rather than a filter: a sound of an
 * unknown extension still stores (extensionless) because the row records its
 * mime type, while a photo that is not one of these is refused outright — the
 * spec requires an upload that is not an accepted image type to write no file.
 */
const PHOTO_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** The extension to store, for an upload whose name carries none usable. */
const PHOTO_EXTENSION_OF_TYPE: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/jpg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

/* ------------------------------------------------------------------ generic */

/**
 * The name a file is stored under.
 *
 * Generated, never the client's (spec: "the stored filename SHALL be generated
 * by the system"). A UUID plus a vetted extension has no path separators and no
 * `..`, so an upload called `../../etc/passwd` cannot address anything outside
 * the directory — the traversal is not sanitised out of the client's name, the
 * client's name simply never reaches the path.
 */
function generatedName(clientName: string, allowed: Set<string>): string {
  const extension = extname(clientName).toLowerCase();
  const suffix = allowed.has(extension) ? extension : "";
  return `${crypto.randomUUID()}${suffix}`;
}

/** Absolute-enough path for a stored file. Never built from client input. */
const pathIn = (dir: string, fileName: string) => join(dir, fileName);

const ensureDir = (dir: string) => mkdir(dir, { recursive: true });

async function writeIn(
  dir: string,
  fileName: string,
  bytes: ArrayBuffer
): Promise<void> {
  await ensureDir(dir);
  await writeFile(pathIn(dir, fileName), Buffer.from(bytes));
}

/** Deleting the row deletes the file; a missing file is not an error. */
async function deleteIn(dir: string, fileName: string): Promise<void> {
  try {
    await unlink(pathIn(dir, fileName));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

/**
 * Used by /health, alongside the database and cache pings. Writes and removes a
 * probe file rather than calling `access()`: a directory can be reported
 * writable by its mode bits and still refuse a write on a read-only mount or a
 * full volume, and it is the write that matters here.
 */
async function pingDir(dir: string): Promise<boolean> {
  try {
    await ensureDir(dir);
    const probe = join(dir, `.probe-${crypto.randomUUID()}`);
    await writeFile(probe, "");
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------------- sounds */

export const storedFileName = (clientName: string) =>
  generatedName(clientName, SAFE_EXTENSIONS);

export const soundPath = (fileName: string) => pathIn(env.SOUND_DIR, fileName);

export const ensureSoundDir = () => ensureDir(env.SOUND_DIR);

export const writeSound = (fileName: string, bytes: ArrayBuffer) =>
  writeIn(env.SOUND_DIR, fileName, bytes);

export const deleteSound = (fileName: string) =>
  deleteIn(env.SOUND_DIR, fileName);

export const pingSoundStorage = () => pingDir(env.SOUND_DIR);

/* ------------------------------------------------------------------- photos */

/**
 * The name a photo is stored under, or `null` if it may not be stored at all.
 *
 * The extension is taken from the client's name only when it is already on the
 * allow-list, and otherwise from the declared content type — both client-
 * supplied, which is precisely why neither is used as anything but a lookup key
 * into a fixed set. An upload that matches neither is refused rather than
 * stored extensionless: an unknown byte stream under a name a browser will
 * happily fetch is not something to keep.
 */
export function storedPhotoName(
  clientName: string,
  mimeType: string
): string | null {
  const extension = extname(clientName).toLowerCase();
  if (PHOTO_EXTENSIONS.has(extension))
    return `${crypto.randomUUID()}${extension}`;
  const fromType = PHOTO_EXTENSION_OF_TYPE[mimeType.toLowerCase()];
  return fromType ? `${crypto.randomUUID()}${fromType}` : null;
}

/**
 * The content type to serve a stored photo under.
 *
 * Derived from the extension rather than remembered per row, which is exact
 * here and is not for sounds: a photo's extension is one of four this module
 * chose itself in `storedPhotoName`, so there is nothing to look up and nothing
 * a client influenced. The `?? ""` case is unreachable through that function
 * and is only what a hand-placed file would get.
 */
const PHOTO_TYPE_OF_EXTENSION: Record<string, string> = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
};

export const photoMimeType = (fileName: string): string =>
  PHOTO_TYPE_OF_EXTENSION[extname(fileName).toLowerCase()] ?? "";

export const photoPath = (fileName: string) => pathIn(env.PHOTO_DIR, fileName);

export const ensurePhotoDir = () => ensureDir(env.PHOTO_DIR);

export const writePhoto = (fileName: string, bytes: ArrayBuffer) =>
  writeIn(env.PHOTO_DIR, fileName, bytes);

export const deletePhoto = (fileName: string) =>
  deleteIn(env.PHOTO_DIR, fileName);

export const pingPhotoStorage = () => pingDir(env.PHOTO_DIR);
