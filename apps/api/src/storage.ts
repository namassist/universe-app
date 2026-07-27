/**
 * Sound file storage (design D7).
 *
 * The bytes live on the filesystem under `SOUND_DIR` and are served with
 * `Bun.file`, which is a lazy handle: the file never enters this process's
 * heap, and after the first read the OS page cache serves it. Postgres `bytea`
 * was the alternative — it needs no volume and rides the database backup — but
 * every read would pull the whole blob across the connection and de-TOAST it
 * first, which for a clip several kiosks play on a schedule is the whole
 * decision.
 *
 * The cost is a directory that has to survive a redeploy. That is why the
 * location is explicit configuration and why `/health` reports on it: a missing
 * volume should surface at startup, not at the first upload.
 */

import { mkdir, unlink, writeFile } from "node:fs/promises";
import { extname, join } from "node:path";

import { env } from "./env";

/** Small enough that a hostile file fails fast, ample for a bell or a siren. */
export const MAX_SOUND_BYTES = 2 * 1024 * 1024;

/** Extensions kept from an upload. Anything else stores without one. */
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
 * The name a file is stored under.
 *
 * Generated, never the client's (spec: "the stored filename SHALL be generated
 * by the system"). A UUID plus a vetted extension has no path separators and no
 * `..`, so an upload called `../../etc/passwd` cannot address anything outside
 * the directory — the traversal is not sanitised out of the client's name, the
 * client's name simply never reaches the path.
 */
export function storedFileName(clientName: string): string {
  const extension = extname(clientName).toLowerCase();
  const suffix = SAFE_EXTENSIONS.has(extension) ? extension : "";
  return `${crypto.randomUUID()}${suffix}`;
}

/** Absolute-enough path for a stored file. Never built from client input. */
export function soundPath(fileName: string): string {
  return join(env.SOUND_DIR, fileName);
}

export async function ensureSoundDir(): Promise<void> {
  await mkdir(env.SOUND_DIR, { recursive: true });
}

export async function writeSound(
  fileName: string,
  bytes: ArrayBuffer
): Promise<void> {
  await ensureSoundDir();
  await writeFile(soundPath(fileName), Buffer.from(bytes));
}

/** Deleting the row deletes the file; a missing file is not an error. */
export async function deleteSound(fileName: string): Promise<void> {
  try {
    await unlink(soundPath(fileName));
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
export async function pingSoundStorage(): Promise<boolean> {
  try {
    await ensureSoundDir();
    const probe = join(env.SOUND_DIR, `.probe-${crypto.randomUUID()}`);
    await writeFile(probe, "");
    await unlink(probe);
    return true;
  } catch {
    return false;
  }
}
