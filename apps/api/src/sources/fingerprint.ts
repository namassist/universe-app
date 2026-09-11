/**
 * The fingerprint machines themselves — Solution X100-C, on the site's own LAN.
 *
 * Until now a tap reached us third-hand: the machine recorded it, an agent we
 * do not own copied it into Nakula, and we read Nakula. This is the first hand.
 *
 * **Two transports, deliberately.** The attendance log comes over the machine's
 * SOAP endpoint — an HTTP POST with an XML body, parsed here, no library. The
 * record *count* has no SOAP command (measured 2026-09-11: a date filter is
 * ignored and `GetOption` returns empty), so that one question goes over the
 * binary protocol on port 4370 instead. The data path, which is the part that
 * matters, depends on nothing but `fetch`.
 *
 * ## This module cannot delete anything, and that is enforced
 *
 * The machines are shared. Other services read the same logs and their record
 * of the site's attendance depends on those logs surviving. So:
 *
 * - the only commands named here are the two that read
 * - there is no general "send any command" function to reach past them
 * - `fingerprint.readonly.test.ts` reads this file and fails the build if a
 *   write command ever appears in it, however it got here
 *
 * `ClearData` exists on these machines and would empty one in a single request.
 * It is not implemented here, not imported, and not reachable. The reference
 * implementation we learned the protocol from carries a `ClearAttLog()` it
 * never calls; a function that exists can be called by the next person, and an
 * editor will offer it beside the one they meant.
 *
 * Every request made through this module is recorded — see `device-log.ts`.
 * When somebody asks what we did to a machine at 11:42, the answer is a list.
 */

import ZKLib from "node-zklib";

import { recordDeviceRequest } from "../device-log";

/** What the machine's SOAP endpoint is called. Fixed in firmware. */
const SOAP_PATH = "/iWsService";

/** The binary protocol port, for the count only. Fixed in firmware. */
const ZK_PORT = 4370;

/**
 * Every command this module may speak.
 *
 * A union rather than a string, so a command outside it does not compile. This
 * is the first of the three guards named above and the only one the type
 * system can enforce on its own.
 */
export type ReadCommand = "GetAttLog";

/** One tap, as the machine recorded it. */
export type DeviceTap = {
  /** The machine's `PIN`, which at this site is the employee's NIK. */
  nik: string;
  /**
   * Local wall-clock, `"YYYY-MM-DD HH:MM:SS"`, exactly as sent.
   *
   * Kept as text on purpose. The machine states no zone, so building a `Date`
   * would bind the reading to whatever zone the process happens to run in —
   * which is how the binary client reported an 08:29:34 tap as `00:29:34Z`.
   * Whether that text means the site's morning is the roster's question, not
   * this module's.
   */
  at: string;
  /** `Status` 0 is an arrival, 1 a departure — pinned against the machine's
   *  own web interface, which labels the former "IN". */
  direction: "in" | "out";
  /** How the person was verified; 1 is a fingerprint. */
  verified: number;
};

const tagOf = (row: string, tag: string): string => {
  const match = row.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
  return match?.[1]?.trim() ?? "";
};

/**
 * Rows out of a `GetAttLogResponse`.
 *
 * Tolerant by design, and in one direction only: a row carrying a field we have
 * never seen is parsed for the fields we know, while a row missing what
 * identifies it is dropped. Fifty-eight machines and two firmwares read so far
 * — one unfamiliar tag must not take a morning's attendance down with it, and
 * one nameless row must not be read as somebody's arrival.
 */
export function parseAttLog(xml: string): DeviceTap[] {
  const taps: DeviceTap[] = [];
  for (const [, row] of xml.matchAll(/<Row>([\s\S]*?)<\/Row>/g)) {
    const nik = tagOf(row!, "PIN");
    const at = tagOf(row!, "DateTime");
    if (!nik || !at) continue;
    taps.push({
      nik,
      at,
      direction: tagOf(row!, "Status") === "1" ? "out" : "in",
      verified: Number(tagOf(row!, "Verified")) || 0,
    });
  }
  return taps;
}

/**
 * Every tap a machine is holding.
 *
 * The whole log, every time: the machines are never cleared and there is no
 * way to ask for a range (measured 2026-09-11 — two date-filter shapes were
 * ignored, while a per-person filter works and is no use for collection). The
 * caller decides what is new; `fetchLogCount` is how it avoids asking at all.
 */
export async function fetchAttLog(
  ip: string,
  comKey: number,
  timeoutMs = 10_000
): Promise<DeviceTap[]> {
  const body =
    `<GetAttLog><ArgComKey xsi:type="xsd:integer">${comKey}</ArgComKey>` +
    `<Arg><PIN xsi:type="xsd:integer">All</PIN></Arg></GetAttLog>`;

  const started = Date.now();
  try {
    const response = await fetch(`http://${ip}${SOAP_PATH}`, {
      method: "POST",
      headers: { "Content-Type": "text/xml" },
      body,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const taps = parseAttLog(await response.text());
    await recordDeviceRequest({
      ip,
      command: "GetAttLog",
      ok: response.ok,
      note: `${taps.length} tap, ${Date.now() - started}ms`,
    });
    return taps;
  } catch (error) {
    await recordDeviceRequest({
      ip,
      command: "GetAttLog",
      ok: false,
      note: reasonOf(error),
    });
    return [];
  }
}

/**
 * How many records a machine holds — the cheap question.
 *
 * Asked so the expensive one can be skipped: a count that has not moved since
 * last time means no new taps and no reason to pull a log that returns in full
 * every time. A production machine holds 20,029 records, which is 2.58 MB a
 * pull; asking first is what makes a short cadence affordable at all.
 *
 * `null` when the machine cannot be reached or will not say. Never throws —
 * the caller is in the middle of a muster and a silent machine is an answer,
 * not an emergency.
 */
export async function fetchLogCount(
  ip: string,
  timeoutMs = 10_000
): Promise<number | null> {
  const started = Date.now();
  const zk = new ZKLib(ip, ZK_PORT, timeoutMs, 4000);
  try {
    /*
     * Our own clock, not the library's.
     *
     * `node-zklib` takes a timeout and was measured not to honour it on a
     * connect to an address that never answers — 1.5 s asked, over 5 s taken.
     * A muster pulls thirty-odd machines on a short cadence, and two dead ones
     * holding the cycle open is how a board arrives after the bus.
     */
    const count = await deadline(
      (async () => {
        await zk.createSocket();
        const info = await zk.getInfo();
        return typeof info?.logCounts === "number" ? info.logCounts : null;
      })(),
      timeoutMs
    );
    await recordDeviceRequest({
      ip,
      command: "GetInfo",
      ok: count !== null,
      note: `${count ?? "tanpa jawaban"}, ${Date.now() - started}ms`,
    });
    return count;
  } catch (error) {
    await recordDeviceRequest({
      ip,
      command: "GetInfo",
      ok: false,
      note: reasonOf(error),
    });
    return null;
  } finally {
    /* Always, and never allowed to throw: a socket left open on a machine that
       tolerates one conversation at a time is the next pull's failure. */
    try {
      await zk.disconnect();
    } catch {
      /* the machine has already gone; nothing here can improve on that */
    }
  }
}

/** A short reason for the log — never the whole error, which can carry a URL. */
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.name : "gagal";

/**
 * Give up after `ms`, whatever the thing we are waiting on decides to do.
 *
 * The abandoned work keeps running until it finishes or fails — we cannot stop
 * a socket the library owns — but it stops being our caller's problem, and the
 * `finally` above still closes the connection when it eventually lands.
 */
function deadline<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  return Promise.race([
    work.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("Timeout")), ms);
    }),
  ]);
}
