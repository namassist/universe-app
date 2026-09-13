/**
 * The guard on the live session, and the reason it is a second file.
 *
 * `fingerprint.readonly.test.ts` proves the pull client speaks only two read
 * commands. The live session cannot meet that bar: it must authenticate and it
 * must enable the device, or the machine acknowledges the subscription and
 * then stays silent. So the promise here is narrower and stated exactly —
 * four commands, named, and nothing else.
 *
 * `CMD_ENABLE_DEVICE` returns a machine to accepting fingerprints. Its sibling
 * `CMD_DISABLE_DEVICE` would lock one mid-muster, and the day somebody reaches
 * for it this file goes red.
 *
 * Needs nothing — it reads source text.
 *   bun --env-file=.env test src/sources/fingerprint-live.readonly.test.ts
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const modulePath = join(import.meta.dir, "fingerprint-live.ts");

/** The module's code, with its comments stripped: prose may name the danger. */
const code = readFileSync(modulePath, "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, " ")
  .replace(/\/\/[^\n]*/g, " ");

const FORBIDDEN = [
  "ClearData",
  "ClearAttLog",
  "ClearAdmin",
  "ClearACC",
  "SetUserInfo",
  "DeleteUser",
  "deleteUser",
  "Restart",
  "PowerOff",
  "clearAttendanceLog",
  "disableDevice",
  "DISABLE",
  "executeCmd",
  "CMD_CLEAR",
  "CMD_SET",
  "CMD_DELETE",
];

/** The four it may speak, and the whole of the promise. */
const ALLOWED = [
  "CMD_AUTH",
  "CMD_CONNECT",
  "CMD_ENABLE_DEVICE",
  "CMD_REG_EVENT",
];

describe("the live session speaks four commands and no others", () => {
  for (const word of FORBIDDEN)
    test(`it does not mention ${word}`, () => {
      expect(code).not.toContain(word);
    });

  test("the only commands it defines are the four allowed", () => {
    const defined = [...code.matchAll(/const (CMD_[A-Z_]+) =/g)].map(
      (m) => m[1]
    );
    expect([...new Set(defined)].sort()).toEqual(ALLOWED);
  });

  /*
   * The one function that could send anything is `ask`, and it takes the
   * command as a number. Naming the constants is not enough on its own — this
   * is what proves every call site passes one of them.
   */
  test("every packet it sends names one of the four", () => {
    const sent = [...code.matchAll(/ask\(\s*([A-Za-z_]+)/g)].map((m) => m[1]);
    expect(sent.length).toBeGreaterThan(0);
    expect([...new Set(sent)].sort()).toEqual(ALLOWED);
  });

  test("it does not export a way to send an arbitrary command", () => {
    expect(code).not.toMatch(/export\s+(const|function)\s+ask\b/);
    expect(code).not.toMatch(/function\s+send\s*\(/);
  });

  /*
   * The root export carries `clearAttendanceLog`, `disableDevice` and
   * `executeCmd` as methods. Importing the transport and the two pure helpers
   * keeps all of them out of reach rather than merely unused.
   */
  test("it does not import the class that carries the dangerous methods", () => {
    expect(code).not.toMatch(/from\s+"node-zklib"/);
    expect(code).toMatch(/from\s+"node-zklib\/zklibtcp"/);
  });
});
