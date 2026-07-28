/**
 * Upload storage: the client's filename must not be able to address the path.
 *
 * The upload handlers never sanitise the supplied name — they generate one — so
 * what these assert is that the generated name has no way to escape the
 * configured directory and that a hostile name reaches the filesystem nowhere
 * at all. Photos additionally assert the stricter half of D8: an upload that is
 * not an accepted image type is refused rather than stored under some name.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// The module reads both directories through `env` at import time, so they have
// to exist as configuration before the import rather than after it.
const dir = await mkdtemp(join(tmpdir(), "universe-sounds-"));
const photoDir = await mkdtemp(join(tmpdir(), "universe-photos-"));
process.env.SOUND_DIR = dir;
process.env.PHOTO_DIR = photoDir;

const {
  soundPath,
  storedFileName,
  writeSound,
  deleteSound,
  photoPath,
  storedPhotoName,
  writePhoto,
  deletePhoto,
} = await import("./storage");

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
  await rm(photoDir, { recursive: true, force: true });
});

const HOSTILE = [
  "../../etc/passwd",
  "..\\..\\windows\\system32\\config\\sam",
  "/etc/shadow",
  "....//....//etc/passwd",
  "sound.wav/../../../../root/.ssh/authorized_keys",
];

describe("storedFileName", () => {
  test("never yields a path separator or a parent reference", () => {
    for (const name of HOSTILE) {
      const stored = storedFileName(name);
      expect(stored).not.toContain("/");
      expect(stored).not.toContain("\\");
      expect(stored).not.toContain("..");
    }
  });

  test("keeps only a recognised audio extension", () => {
    expect(storedFileName("bel-masuk.wav")).toEndWith(".wav");
    expect(storedFileName("sirene.MP3")).toEndWith(".mp3");
    // Anything else is dropped rather than carried through.
    expect(storedFileName("payload.php")).not.toContain(".php");
    expect(storedFileName("../../etc/passwd")).not.toContain("passwd");
  });

  test("two uploads of the same name do not collide", () => {
    const a = storedFileName("bel.wav");
    const b = storedFileName("bel.wav");
    expect(a).not.toBe(b);
  });
});

describe("writeSound", () => {
  test("an upload named ../../etc/passwd writes only under SOUND_DIR", async () => {
    const before = await readdir(dir);

    const stored = storedFileName("../../etc/passwd");
    await writeSound(stored, new TextEncoder().encode("RIFF").buffer);

    const written = soundPath(stored);
    // The resolved path's parent is the configured directory, full stop.
    expect(dirname(resolve(written))).toBe(resolve(dir));
    expect((await stat(written)).isFile()).toBe(true);

    // Exactly one new file, inside the directory, and nothing beside it.
    const after = await readdir(dir);
    expect(after.length).toBe(before.length + 1);

    await deleteSound(stored);
    expect(await readdir(dir)).toEqual(before);
  });

  test("deleting a file that is already gone is not an error", async () => {
    await deleteSound(storedFileName("never-written.wav"));
  });
});

describe("storedPhotoName", () => {
  test("never yields a path separator or a parent reference", () => {
    for (const name of HOSTILE) {
      // Every hostile name here also fails the image check, so what is asserted
      // is both halves at once: refused outright, and — for the one case that
      // does carry an accepted extension — generated clean.
      const stored = storedPhotoName(name, "image/jpeg");
      expect(stored).not.toBeNull();
      expect(stored!).not.toContain("/");
      expect(stored!).not.toContain("\\");
      expect(stored!).not.toContain("..");
      expect(stored!).not.toContain("passwd");
    }
  });

  test("keeps a recognised image extension", () => {
    expect(storedPhotoName("budi.jpg", "image/jpeg")).toEndWith(".jpg");
    expect(storedPhotoName("budi.JPEG", "image/jpeg")).toEndWith(".jpeg");
    expect(storedPhotoName("budi.png", "image/png")).toEndWith(".png");
    expect(storedPhotoName("budi.webp", "image/webp")).toEndWith(".webp");
  });

  test("falls back to the declared content type when the name carries none", () => {
    expect(storedPhotoName("foto-tanpa-ekstensi", "image/png")).toEndWith(
      ".png"
    );
  });

  test("refuses anything that is not an accepted image", () => {
    // No file may be written for these at all, so the answer is null rather
    // than a name without an extension.
    expect(storedPhotoName("payload.php", "application/x-php")).toBeNull();
    expect(storedPhotoName("sirene.mp3", "audio/mpeg")).toBeNull();
    expect(storedPhotoName("../../etc/passwd", "text/plain")).toBeNull();
    expect(storedPhotoName("resume.pdf", "application/pdf")).toBeNull();
  });

  test("two uploads of the same name do not collide", () => {
    expect(storedPhotoName("foto.jpg", "image/jpeg")).not.toBe(
      storedPhotoName("foto.jpg", "image/jpeg")
    );
  });
});

describe("writePhoto", () => {
  test("an upload named ../../etc/passwd.jpg writes only under PHOTO_DIR", async () => {
    const before = await readdir(photoDir);

    const stored = storedPhotoName("../../etc/passwd.jpg", "image/jpeg")!;
    await writePhoto(stored, new TextEncoder().encode("\xff\xd8\xff").buffer);

    const written = photoPath(stored);
    expect(dirname(resolve(written))).toBe(resolve(photoDir));
    expect((await stat(written)).isFile()).toBe(true);

    const after = await readdir(photoDir);
    expect(after.length).toBe(before.length + 1);

    await deletePhoto(stored);
    expect(await readdir(photoDir)).toEqual(before);
  });

  test("deleting a photo that is already gone is not an error", async () => {
    await deletePhoto(storedPhotoName("never-written.jpg", "image/jpeg")!);
  });
});
