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
 * Each machine's paired printer is probed in the same cycle, the same way: a
 * connect-and-close on its raw port (9100). A machine answering beside a dead
 * printer records the tap and never hands out the slip, and every screen used
 * to call it "online" (2026-10-10). Nothing is written to the printer, and a
 * slip that meets the probe mid-connect is covered by `printWithRetry`.
 *
 * This runs as an interval rather than a timeline stage (`scheduler.ts`)
 * because monitoring is continuous — there is no deadline it is racing.
 */

import { and, eq } from "drizzle-orm";

import { db, schema } from "./db";
import { env } from "./env";
import { tcpReachable, ZK_PORT } from "./netcheck";
import { redis } from "./redis";

/** Injectable so tests exercise the folding logic without a network. */
export type Probe = (ip: string, port: number) => Promise<boolean>;

export type ProbeCycle = {
  probed: number;
  online: number;
  offline: number;
  /** Paired printers probed this cycle, and how many answered. */
  printersProbed: number;
  printersOnline: number;
  /** Devices whose `online` value changed this cycle — the loggable news. */
  flipped: { name: string; online: boolean }[];
};

/** One connect-and-close; see `tcpReachable` in `netcheck.ts`. */
export const tcpProbe: Probe = (ip, port) =>
  tcpReachable(ip, port, env.PROBE_TIMEOUT_MS);

/** The prober-owned columns, identical on machines and printers. */
type Probed = {
  online: boolean;
  missCount: number;
  statusSince: Date | null;
};

/**
 * One probe result folded into a row's columns.
 *
 * The debounce lives here rather than in the caller: a failure increments
 * `miss_count` and only the *threshold* flips `online`, so one dropped packet
 * on a site radio link never reaches the wall. `status_since` moves only on a
 * real transition — it is what lets the screen say how long a device has been
 * down, and rewriting it every cycle would peg that at zero.
 */
function fold(row: Probed, reachable: boolean, now: Date) {
  const misses = reachable ? 0 : row.missCount + 1;
  const online = reachable
    ? true
    : misses >= env.PROBE_MISSES_BEFORE_OFFLINE
      ? false
      : row.online;
  return {
    flipped: online !== row.online,
    set: {
      online,
      missCount: misses,
      checkedAt: now,
      // Last *contact*, not last attempt — the difference is the whole point
      // of showing "terakhir terlihat" next to an offline card.
      ...(reachable ? { lastSeenAt: now } : {}),
      // Untouched when the status is unchanged; also seeded on the first
      // cycle, when a device has no history yet.
      ...(online !== row.online || row.statusSince === null
        ? { statusSince: now }
        : {}),
    },
  };
}

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
 * Printers come second, in the same pool: only those paired with an active
 * machine and themselves active, because those are the ones a slip is sent to.
 */
export async function probeOnce(probe: Probe = tcpProbe): Promise<ProbeCycle> {
  const machines = await db
    .select()
    .from(schema.fingerprintMachines)
    .where(eq(schema.fingerprintMachines.active, true));

  const printers = await db
    .select({
      id: schema.printers.id,
      name: schema.printers.name,
      ip: schema.printers.ip,
      port: schema.printers.port,
      online: schema.printers.online,
      missCount: schema.printers.missCount,
      statusSince: schema.printers.statusSince,
    })
    .from(schema.printers)
    .innerJoin(
      schema.fingerprintMachines,
      eq(schema.fingerprintMachines.printerId, schema.printers.id)
    )
    .where(
      and(
        eq(schema.fingerprintMachines.active, true),
        eq(schema.printers.active, true)
      )
    );

  /* One pool after the other, not side by side: two pools at once would
     double the connects in flight on the same radio links, which is the
     false-alarm mistake the bound exists to prevent. */
  const machineResults = await mapPooled(
    machines,
    env.PROBE_CONCURRENCY,
    async (m) => ({ row: m, reachable: await probe(m.ip, ZK_PORT) })
  );
  const printerResults = await mapPooled(
    printers,
    env.PROBE_CONCURRENCY,
    async (p) => ({ row: p, reachable: await probe(p.ip, p.port) })
  );

  const now = new Date();
  const flipped: ProbeCycle["flipped"] = [];
  let online = 0;
  let printersOnline = 0;

  for (const { row, reachable } of machineResults) {
    const next = fold(row, reachable, now);
    if (next.flipped) flipped.push({ name: row.name, online: next.set.online });
    if (next.set.online) online += 1;
    await db
      .update(schema.fingerprintMachines)
      .set(next.set)
      .where(eq(schema.fingerprintMachines.id, row.id));
  }

  for (const { row, reachable } of printerResults) {
    const next = fold(row, reachable, now);
    if (next.flipped)
      flipped.push({ name: `printer ${row.name}`, online: next.set.online });
    if (next.set.online) printersOnline += 1;
    await db
      .update(schema.printers)
      .set(next.set)
      .where(eq(schema.printers.id, row.id));
  }

  return {
    probed: machines.length,
    online,
    offline: machines.length - online,
    printersProbed: printers.length,
    printersOnline,
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
