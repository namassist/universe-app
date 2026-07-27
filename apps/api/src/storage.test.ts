/**
 * Sound storage: the client's filename must not be able to address the path.
 *
 * The upload handler never sanitises the supplied name — it generates one — so
 * what these assert is that the generated name has no way to escape SOUND_DIR
 * and that a hostile name reaches the filesystem nowhere at all.
 */

import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

// The module reads SOUND_DIR through `env` at import time, so the directory has
// to exist as configuration before the import rather than after it.
const dir = await mkdtemp(join(tmpdir(), "universe-sounds-"));
process.env.SOUND_DIR = dir;

const { soundPath, storedFileName, writeSound, deleteSound } =
  await import("./storage");

afterAll(async () => {
  await rm(dir, { recursive: true, force: true });
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
