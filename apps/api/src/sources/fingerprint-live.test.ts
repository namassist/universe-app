/**
 * The parts of a live session that can be judged without a machine.
 *
 * The handshake itself is proven against hardware — a tap at 18:49:41 arriving
 * as an event at 18:49:42 on 2026-09-12 — but framing, time and the commkey
 * are arithmetic, and arithmetic belongs here. Each of these was a real bug
 * first.
 *
 * Needs nothing:
 *   bun --env-file=.env test src/sources/fingerprint-live.test.ts
 */

import { describe, expect, test } from "bun:test";
import { createTCPHeader } from "node-zklib/utils";

import {
  makeCommkey,
  readFrames,
  replyOf,
  wallClockOf,
} from "./fingerprint-live";

const frame = (command: number, sessionId: number, data: Buffer | string) =>
  createTCPHeader(command, sessionId, 0, data);

describe("reading the stream", () => {
  test("splits two frames that arrived in one chunk", () => {
    const chunk = Buffer.concat([frame(2000, 7, ""), frame(500, 7, "")]);
    const { frames, rest } = readFrames(chunk);
    expect(frames).toHaveLength(2);
    expect(rest).toHaveLength(0);
  });

  /* TCP does not promise message boundaries. Handling each chunk as a message
     is how a tap is read as half a tap. */
  test("keeps a half-arrived frame for the next chunk", () => {
    const whole = frame(2000, 7, "");
    const first = readFrames(whole.subarray(0, 6));
    expect(first.frames).toHaveLength(0);
    expect(first.rest).toHaveLength(6);

    const second = readFrames(Buffer.concat([first.rest, whole.subarray(6)]));
    expect(second.frames).toHaveLength(1);
    expect(second.rest).toHaveLength(0);
  });

  test("resynchronises past noise instead of reading a length out of it", () => {
    const noisy = Buffer.concat([
      Buffer.from([0x00, 0xff]),
      frame(2000, 7, ""),
    ]);
    const { frames } = readFrames(noisy);
    expect(frames).toHaveLength(1);
    expect(replyOf(frames[0]!).command).toBe(2000);
  });

  test("reads the command and session back out", () => {
    const reply = replyOf(frame(2005, 1234, ""));
    expect(reply.command).toBe(2005);
    expect(reply.sessionId).toBe(1234);
  });
});

describe("the machine's own clock", () => {
  /*
   * The library builds the machine's local fields as though they were UTC, so
   * a tap at 18:49:41 arrives as ...T10:49:41Z. Storing that as an instant is
   * how an 08:29 tap once became 00:29Z.
   */
  test("recovers the wall clock the machine actually sent", () => {
    const asLibraryBuildsIt = new Date("2026-09-12T18:49:41.000Z");
    expect(wallClockOf(asLibraryBuildsIt)).toBe("2026-09-12 18:49:41");
  });

  test("pads every field", () => {
    expect(wallClockOf(new Date("2026-01-02T03:04:05.000Z"))).toBe(
      "2026-01-02 03:04:05"
    );
  });
});

describe("the commkey handshake", () => {
  /*
   * The third byte is `ticks` itself. Writing the previous step's third byte
   * there makes a correct comm key read as wrong, and the machine answers
   * ACK_UNAUTH either way — indistinguishable from a wrong key, which is what
   * made it cost an evening.
   */
  test("the third byte is the tick count", () => {
    expect(makeCommkey(0, 10648)[2]).toBe(50);
    expect(makeCommkey(0, 10648, 7)[2]).toBe(7);
  });

  test("is four bytes and deterministic", () => {
    const once = makeCommkey(0, 7733);
    expect(once).toHaveLength(4);
    expect([...makeCommkey(0, 7733)]).toEqual([...once]);
  });

  test("a different session yields a different key", () => {
    expect([...makeCommkey(0, 7733)]).not.toEqual([...makeCommkey(0, 7989)]);
  });

  /*
   * Surprising, and pyzk does exactly the same: the third byte is overwritten
   * with `ticks`, and the byte it replaces carries the low half of the session
   * id. So two sessions differing only there produce the same key. The machine
   * accepts it — this is the firmware's own scheme, not our shortcut — but a
   * reader who assumes every session yields a distinct key would be wrong.
   */
  test("one byte of the session is dropped by the tick byte", () => {
    expect([...makeCommkey(0, 7733)]).toEqual([...makeCommkey(0, 7734)]);
  });
});
