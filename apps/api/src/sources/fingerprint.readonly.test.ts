/**
 * The guard on the one promise this feature cannot break.
 *
 * The fingerprint machines are shared. Other services read the same logs, and
 * their record of the site's attendance depends on those logs surviving. If
 * data goes missing, we are the newest thing on the network and will be asked
 * first (owner, 2026-09-11).
 *
 * `ClearData` would empty a machine in one request. Nothing stops a future
 * change reaching for it — an editor offers `clearAttendanceLog` beside the
 * `getAttendances` somebody meant, and the library we depend on carries both.
 * A reviewer noticing is not a mechanism. This is the mechanism: it reads our
 * own client and fails the build before the change can ship.
 *
 * If this file is in your way, you are about to do the thing it exists to
 * prevent. Read the "cannot delete anything" section of `fingerprint.ts`
 * first, and take it to whoever owns the attendance data.
 *
 * Needs nothing — it reads source text.
 *   bun --env-file=.env test src/sources/fingerprint.readonly.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const clientPath = join(import.meta.dir, "fingerprint.ts");

/**
 * The client's **code**, with its comments stripped out.
 *
 * The file explains at length that `ClearData` exists on these machines, would
 * empty one in a single request, and is deliberately not implemented. That
 * explanation is the most useful thing in the file for whoever reads it next,
 * and checking the raw text would force it to be deleted to satisfy a test
 * meant to protect it.
 *
 * So: prose may name the danger. Code may not reach for it.
 */
const client = readFileSync(clientPath, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/[^\n]*/g, " ");

/**
 * Everything that changes a machine, in the spellings the two protocols use.
 *
 * SOAP names them as XML elements, the binary client as `CMD_*` constants and
 * as methods. A single list covers both, because the point is not to model the
 * protocols — it is that none of these words belongs in this file.
 */
const FORBIDDEN = [
  "ClearData",
  "ClearAttLog",
  "ClearAdmin",
  "ClearACC",
  "SetUserInfo",
  "DeleteUser",
  "Restart",
  "PowerOff",
  "clearAttendanceLog",
  "disableDevice",
  "enableDevice",
  "executeCmd",
  "CMD_CLEAR",
  "CMD_SET",
  "CMD_DELETE",
];

describe("the device client cannot change a machine", () => {
  for (const word of FORBIDDEN)
    test(`it does not mention ${word}`, () => {
      expect(client).not.toContain(word);
    });

  /*
   * Stated positively as well. The list above only catches what we thought of;
   * this catches a command we have never heard of, because anything the client
   * sends has to be one of the two we allow.
   */
  test("the only commands it names are the two that read", () => {
    const commands = [...client.matchAll(/command:\s*"([A-Za-z]+)"/g)].map(
      (m) => m[1]
    );
    expect(commands.length).toBeGreaterThan(0);
    expect([...new Set(commands)].sort()).toEqual(["GetAttLog", "GetInfo"]);
  });

  /*
   * No general escape hatch. A function that forwards an arbitrary command
   * would satisfy every check above and defeat all of them.
   */
  test("there is no way to send an arbitrary command", () => {
    expect(client).not.toMatch(/function\s+send\s*\(/);
    expect(client).not.toMatch(/command:\s*(?:string|cmd|command)\b/);
  });
});

describe("the library underneath cannot change without us noticing", () => {
  /*
   * Pinned exactly — no `^`, no `~`. `node-zklib` was last published in
   * February 2020, so in practice nothing is coming; the pin is here for the
   * case where that stops being true, since a read that quietly started
   * locking the device would be found in the yard rather than in a diff.
   */
  test("node-zklib is pinned to an exact version", () => {
    const pkg = JSON.parse(
      readFileSync(join(import.meta.dir, "../../package.json"), "utf8")
    ) as { dependencies?: Record<string, string> };
    const pinned = pkg.dependencies?.["node-zklib"];
    expect(pinned).toBeDefined();
    expect(pinned).toMatch(/^\d+\.\d+\.\d+$/);
  });
});
