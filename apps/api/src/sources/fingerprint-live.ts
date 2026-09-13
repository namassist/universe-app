/**
 * A live session with one fingerprint machine.
 *
 * The periodic pull in `fingerprint.ts` answers "who tapped this morning" a
 * minute and a half later. That is right for a board and useless for somebody
 * standing at a printer waiting for a ticket. This is the other half: the
 * machine pushes a tap as it happens, measured at about one second.
 *
 * ## What it took to make the machine talk
 *
 * Four dead ends were tried first (2026-09-12) and none of them was the
 * problem: the event flag, an all-events flag, the UDP transport, and a second
 * library. The machine answered every registration with `ACK_OK` and then sent
 * nothing, because:
 *
 * 1. **The session must be authenticated.** `CMD_CONNECT` is refused with
 *    `CMD_ACK_UNAUTH` (2005). The answer is `CMD_AUTH` carrying a key derived
 *    from the comm key and the session id. `node-zklib` never checks that
 *    reply, so an unauthenticated session looks perfectly healthy.
 * 2. **The device must be enabled before it will push.** `CMD_ENABLE_DEVICE`,
 *    then `CMD_REG_EVENT` (caobo171/node-zklib#26).
 *
 * ## This module cannot change a machine beyond enabling it
 *
 * It speaks four commands and no others, and it builds each packet itself
 * rather than calling the library's `executeCmd` — a function that forwards an
 * arbitrary command would satisfy every check and defeat all of them. The
 * declaration in `node-zklib.d.ts` omits every other method, so reaching for
 * one fails to compile, and `fingerprint-live.readonly.test.ts` reads this
 * file and fails the build if a forbidden word appears.
 *
 * `CMD_ENABLE_DEVICE` returns a machine to accepting fingerprints. Its sibling
 * `CMD_DISABLE_DEVICE` would lock one mid-muster and is not implemented, not
 * declared, and refused by the guard.
 */

/* eslint-disable-next-line @typescript-eslint/triple-slash-reference --
   an ambient module declaration cannot be imported; see `fingerprint.ts`. */
/// <reference path="./node-zklib.d.ts" />
import ZKLibTCP, { type ZkSocket } from "node-zklib/zklibtcp";
import { createTCPHeader, decodeRecordRealTimeLog52 } from "node-zklib/utils";

import { recordDeviceRequest } from "../device-log";

/** The binary protocol port. Fixed in firmware. */
const ZK_PORT = 4370;

/**
 * Every command this module may speak, and nothing else.
 *
 * Named rather than passed in: a command that arrives as an argument is a
 * command nobody can audit by reading the file.
 */
const CMD_CONNECT = 1000;
const CMD_AUTH = 1102;
const CMD_ENABLE_DEVICE = 1002;
const CMD_REG_EVENT = 500;

const ACK_OK = 2000;
const ACK_UNAUTH = 2005;

/** Every TCP frame opens with this, then a little-endian payload length. */
const FRAME_MAGIC = 0x7d825050;
const WRAPPER = 8;

/** Subscribe to attendance events. The payload the firmware expects. */
const EVENT_FLAG = Buffer.from([0x01, 0x00, 0x00, 0x00]);

export type LiveTap = {
  /** The machine's `PIN`, which at this site is the employee's NIK. */
  nik: string;
  /** Local wall clock, `"YYYY-MM-DD HH:MM:SS"`, exactly as the machine said. */
  at: string;
};

export type LiveSession = {
  readonly ip: string;
  /** Close the socket. Safe to call twice. */
  stop: () => Promise<void>;
};

/**
 * The commkey handshake, ported from pyzk.
 *
 * The third byte of the result is `ticks` itself, not the third byte of the
 * previous step — getting that one byte wrong makes a *correct* comm key read
 * as wrong, and the machine answers `ACK_UNAUTH` either way. That cost an
 * evening on 2026-09-12.
 */
export function makeCommkey(
  key: number,
  sessionId: number,
  ticks = 50
): Buffer {
  let k = 0;
  for (let i = 0; i < 32; i++)
    k = key & (1 << i) ? ((k << 1) | 1) >>> 0 : (k << 1) >>> 0;
  k = (k + sessionId) >>> 0;

  const packed = Buffer.alloc(4);
  packed.writeUInt32LE(k, 0);
  const xored = Buffer.from([
    packed[0]! ^ 0x5a /* Z */,
    packed[1]! ^ 0x4b /* K */,
    packed[2]! ^ 0x53 /* S */,
    packed[3]! ^ 0x4f /* O */,
  ]);
  /* `unpack('HH')` then `pack('HH', k[1], k[0])` — the two half-words swap. */
  const swapped = Buffer.from([xored[2]!, xored[3]!, xored[0]!, xored[1]!]);
  const b = ticks & 0xff;
  return Buffer.from([swapped[0]! ^ b, swapped[1]! ^ b, b, swapped[3]! ^ b]);
}

/**
 * The machine's wall clock, recovered from the library's `Date`.
 *
 * `parseHexToTime` builds `new Date(year, month, day, hour, ...)` — *local*
 * components — so the local getters return exactly the six numbers the machine
 * sent, and the ISO form does not: a tap at 18:49:41 prints as
 * `...T10:49:41.000Z` here at UTC+8.
 *
 * Read with the UTC getters at first, which shifted every stored tap by the
 * process's own offset — eight hours — and was caught by the owner's own test
 * on 2026-09-13, when a 21:11 tap was written down as 13:11. The reading is
 * stored as the machine's text for the same reason `device_taps` does it: the
 * device states no zone, and binding it to a zone is how an 08:29 tap once
 * became `00:29Z`.
 */
export function wallClockOf(attTime: Date): string {
  const two = (n: number) => String(n).padStart(2, "0");
  return (
    `${attTime.getFullYear()}-${two(attTime.getMonth() + 1)}-` +
    `${two(attTime.getDate())} ${two(attTime.getHours())}:` +
    `${two(attTime.getMinutes())}:${two(attTime.getSeconds())}`
  );
}

/** Split a stream into whole frames, keeping whatever is still incomplete. */
export function readFrames(buffer: Buffer): { frames: Buffer[]; rest: Buffer } {
  const frames: Buffer[] = [];
  let rest = buffer;
  while (rest.length >= WRAPPER) {
    if (rest.readUInt32LE(0) !== FRAME_MAGIC) {
      /* Not our framing. Drop a byte and resynchronise rather than reading
         the length out of noise. */
      rest = rest.subarray(1);
      continue;
    }
    const total = WRAPPER + rest.readUInt32LE(4);
    if (rest.length < total) break;
    frames.push(rest.subarray(0, total));
    rest = rest.subarray(total);
  }
  return { frames, rest };
}

/** The command a reply carries, and the session it belongs to. */
export function replyOf(frame: Buffer): { command: number; sessionId: number } {
  return {
    command: frame.readUInt16LE(WRAPPER),
    sessionId: frame.readUInt16LE(WRAPPER + 4),
  };
}

/** Whether a frame carries a tap rather than an acknowledgement. */
const isEvent = (frame: Buffer) =>
  frame.length > 16 && replyOf(frame).command === CMD_REG_EVENT;

export type OpenLive = (options: {
  ip: string;
  comKey?: number;
  timeoutMs?: number;
  onTap: (tap: LiveTap) => void;
  onClosed?: (reason: string) => void;
}) => Promise<LiveSession>;

/**
 * Open a session, authenticate, enable the device, and subscribe.
 *
 * Rejects if any step is refused, so a caller never holds a session that looks
 * open and will never deliver anything — which is exactly the failure this
 * module exists to have found.
 */
export const openLiveSession: OpenLive = async ({
  ip,
  comKey = 0,
  timeoutMs = 8000,
  onTap,
  onClosed,
}) => {
  const started = Date.now();
  const tcp = new ZKLibTCP(ip, ZK_PORT, timeoutMs);
  await tcp.createSocket(
    () => {},
    () => {}
  );
  const socket = tcp.socket;
  if (!socket) throw new Error("socket tidak terbuka");

  let closed = false;
  let pending: ((frame: Buffer) => void) | null = null;
  let buffered: Buffer<ArrayBufferLike> = Buffer.alloc(0);
  let sessionId = 0;
  let replyId = 0;

  socket.on("data", (chunk: Buffer) => {
    const { frames, rest } = readFrames(Buffer.concat([buffered, chunk]));
    buffered = rest;
    for (const frame of frames) {
      if (isEvent(frame)) {
        const { userId, attTime } = decodeRecordRealTimeLog52(frame);
        onTap({ nik: String(userId), at: wallClockOf(attTime) });
        continue;
      }
      const resolve = pending;
      pending = null;
      resolve?.(frame);
    }
  });
  /* A lasting listener, not the library's `once`: the second error on a dead
     socket would otherwise arrive unheard and take the process down. */
  socket.on("error", () => close("error"));
  socket.on("close", () => close("closed"));

  function close(reason: string) {
    if (closed) return;
    closed = true;
    try {
      socket!.destroy();
    } catch {
      /* already gone; nothing here can improve on that */
    }
    onClosed?.(reason);
  }

  /** Send one packet and wait for the machine's answer. */
  const ask = (command: number, data: Buffer | string) =>
    new Promise<Buffer>((resolve, reject) => {
      if (closed) return reject(new Error("sesi sudah ditutup"));
      const timer = setTimeout(() => {
        pending = null;
        reject(new Error(`tidak ada jawaban untuk perintah ${command}`));
      }, timeoutMs);
      pending = (frame) => {
        clearTimeout(timer);
        resolve(frame);
      };
      if (command !== CMD_CONNECT) replyId += 1;
      socket!.write(createTCPHeader(command, sessionId, replyId, data));
    });

  try {
    let reply = await ask(CMD_CONNECT, "");
    sessionId = replyOf(reply).sessionId;

    if (replyOf(reply).command === ACK_UNAUTH) {
      reply = await ask(CMD_AUTH, makeCommkey(comKey, sessionId));
      if (replyOf(reply).command !== ACK_OK)
        throw new Error("kunci komunikasi ditolak mesin");
    }

    /* Before subscribing, and this is the step the library never takes: a
       disabled machine acknowledges the subscription and then stays silent. */
    await ask(CMD_ENABLE_DEVICE, "");
    await ask(CMD_REG_EVENT, EVENT_FLAG);
  } catch (error) {
    close("gagal membuka");
    await recordDeviceRequest({
      ip,
      command: "Listen",
      ok: false,
      note: error instanceof Error ? error.message : "gagal",
    });
    throw error;
  }

  await recordDeviceRequest({
    ip,
    command: "Listen",
    ok: true,
    note: `sesi terbuka, ${Date.now() - started}ms`,
  });

  return {
    ip,
    stop: async () => {
      close("dihentikan");
      await recordDeviceRequest({
        ip,
        command: "Listen",
        ok: true,
        note: "sesi ditutup",
      });
    },
  };
};

export type { ZkSocket };
