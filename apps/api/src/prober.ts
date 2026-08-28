/**
 * Is that fingerprint machine reachable?
 *
 * The monitoring TV needs a reading Nakula cannot give: its
 * `tbl_finger_last_seen` records the last *tap*, which is activity, not
 * health — a machine nobody has tapped since 04:00 looks identical to one
 * whose power supply died. So we ask the machine directly.
 *
 * The question is deliberately the smallest one that distinguishes a live
 * machine from a dead one: **open a TCP connection to port 4370 and close it**.
 * That is the ZK protocol port every Solution X100-C listens on, but no ZK
 * session is ever established — these devices tolerate one conversation at a
 * time, and whatever agent collects taps into Nakula must keep working. A
 * connect-and-close is the cheapest thing that proves something is answering.
 *
 * Ping would be the wrong instrument: at least one machine on this site
 * (MAIN OFFICE) drops ICMP while happily accepting 4370.
 *
 * This runs as an interval rather than a timeline stage (`scheduler.ts`)
 * because monitoring is continuous — there is no deadline it is racing.
 */

import { eq, sql } from "drizzle-orm";
import net from "node:net";

import { db, schema } from "./db";
import { env } from "./env";
import { redis } from "./redis";

/** The ZK protocol port. Not configurable: it is fixed in device firmware. */
const ZK_PORT = 4370;

/** Injectable so tests exercise the folding logic without a network. */
export type Probe = (ip: string) => Promise<boolean>;

export type ProbeCycle = {
  probed: number;
  online: number;
  offline: number;
  /** Machines whose `online` value changed this cycle — the loggable news. */
  flipped: { name: string; online: boolean }[];
};

/**
 * One TCP connect, resolved as reachable/unreachable and never rejected.
 *
 * Every exit path destroys the socket. A machine that accepts the SYN and then
 * says nothing would otherwise hold a file descriptor open for the OS timeout,
 * and fifty-eight of those a minute is a leak with a clock on it.
 */
export const tcpProbe: Probe = (ip) =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(env.PROBE_TIMEOUT_MS);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(ZK_PORT, ip);
  });

/** Map over `items` with at most `limit` in flight, preserving order. */
async function mapPooled<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const out = new Array<R>(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, () =>
    (async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]!);
      }
    })()
  );
  await Promise.all(workers);
  return out;
}

/**
 * Probe every active machine once and fold the results into their rows.
 *
 * Concurrent but **bounded**. Sequential would take minutes and stop being a
 * heartbeat; all-at-once was worse than slow — firing fifty-eight connects
 * simultaneously was measured to push the slower machines past their timeout,
 * reporting them offline while they answered a lone `nc` in about a second.
 * A false alarm on a monitoring wall is more expensive than a slower cycle,
 * and a pooled cycle still finishes well inside its interval.
 *
 * The debounce lives here rather than in the caller: a failure increments
 * `miss_count` and only the *threshold* flips `online`, so one dropped packet
 * on a site radio link never reaches the wall. `status_since` moves only on a
 * real transition — it is what lets the screen say how long a machine has been
 * down, and rewriting it every cycle would peg that at zero.
 */
export async function probeOnce(probe: Probe = tcpProbe): Promise<ProbeCycle> {
  const machines = await db
    .select()
    .from(schema.fingerprintMachines)
    .where(eq(schema.fingerprintMachines.active, true));

  const results = await mapPooled(
    machines,
    env.PROBE_CONCURRENCY,
    async (m) => ({
      machine: m,
      reachable: await probe(m.ip),
    })
  );

  const now = new Date();
  const flipped: ProbeCycle["flipped"] = [];
  let online = 0;

  for (const { machine, reachable } of results) {
    const misses = reachable ? 0 : machine.missCount + 1;
    const nextOnline = reachable
      ? true
      : misses >= env.PROBE_MISSES_BEFORE_OFFLINE
        ? false
        : machine.online;

    if (nextOnline !== machine.online)
      flipped.push({ name: machine.name, online: nextOnline });
    if (nextOnline) online += 1;

    await db
      .update(schema.fingerprintMachines)
      .set({
        online: nextOnline,
        missCount: misses,
        checkedAt: now,
        // Last *contact*, not last attempt — the difference is the whole point
        // of showing "terakhir terlihat" next to an offline card.
        ...(reachable ? { lastSeenAt: now } : {}),
        // Untouched when the status is unchanged; also seeded on the first
        // cycle, when a machine has no history yet.
        ...(nextOnline !== machine.online || machine.statusSince === null
          ? { statusSince: now }
          : {}),
      })
      .where(eq(schema.fingerprintMachines.id, machine.id));
  }

  return {
    probed: machines.length,
    online,
    offline: machines.length - online,
    flipped,
  };
}

/* ------------------------------------------------------------- the loop */

/**
 * One prober across every process.
 *
 * Same reasoning as the scheduler's claim, with a shorter lease: two API
 * processes probing the same fifty-eight machines would double the traffic
 * they see and race each other's writes. The lease expires just before the
 * next cycle, so a process that dies mid-cycle does not stop the next one.
 */
const LEASE_KEY = "prober:cycle";

async function claimCycle(): Promise<boolean> {
  const ttl = Math.max(1, env.PROBE_INTERVAL_SECONDS - 1);
  const result = await redis.set(LEASE_KEY, "1", "EX", ttl, "NX");
  return result === "OK";
}

let timer: ReturnType<typeof setInterval> | null = null;

async function runCycle(): Promise<void> {
  if (!(await claimCycle())) return;
  const cycle = await probeOnce();
  // Only transitions are worth a line: a steady wall would otherwise write a
  // paragraph a minute into the log and bury the news.
  if (cycle.flipped.length)
    for (const f of cycle.flipped)
      console.log(
        `[prober] ${f.name} → ${f.online ? "ONLINE" : "OFFLINE"} ` +
          `(${cycle.online}/${cycle.probed} online)`
      );
}

export function startProber(): void {
  if (timer) return;
  void runCycle().catch((error) =>
    console.error("[prober] cycle failed", error)
  );
  timer = setInterval(() => {
    void runCycle().catch((error) =>
      console.error("[prober] cycle failed", error)
    );
  }, env.PROBE_INTERVAL_SECONDS * 1000);
  console.log(
    `[prober] started — every ${env.PROBE_INTERVAL_SECONDS}s, ` +
      `offline after ${env.PROBE_MISSES_BEFORE_OFFLINE} misses`
  );
}

export function stopProber(): void {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

/** Totals for the kiosk, read from the probed rows — never a live socket. */
export async function machineBoard() {
  const rows = await db
    .select()
    .from(schema.fingerprintMachines)
    .where(eq(schema.fingerprintMachines.active, true))
    .orderBy(
      // Offline first: the wall exists to surface what is broken.
      sql`${schema.fingerprintMachines.online} asc`,
      schema.fingerprintMachines.name
    );
  return rows;
}
