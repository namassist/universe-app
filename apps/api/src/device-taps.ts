/**
 * One pass of collecting taps from the fingerprint machines.
 *
 * Ask each machine how many records it holds; pull the log only from the ones
 * that have grown; keep the taps belonging to people we know; store them.
 *
 * **Ask before pulling, because pulling is the expensive part.** A machine
 * offers no way to request a range — measured 2026-09-11, two date-filter
 * shapes were ignored — so a pull returns the whole log every time, which on a
 * production machine holding 20,029 records is 2.58 MB. A count is a few
 * hundred bytes. Outside a muster almost every machine answers "same as
 * before" and costs nothing more than that; without this, thirty machines on a
 * thirty-second cadence would move tens of gigabytes a morning.
 *
 * **Nothing here writes to a machine.** The client it calls cannot — see the
 * guarantee in `sources/fingerprint.ts` and the test that enforces it — and
 * every request either function makes is recorded in `device_requests`.
 *
 * Nothing downstream reads these taps yet. `finger_readings` is still written
 * by the Nakula ingest and the board still reads that; the two run side by side
 * until they have been compared.
 */

import { and, eq, lt, sql } from "drizzle-orm";
import type { DeviceReportMoment } from "@universe/contracts";

import { db, schema } from "./db";
import { env } from "./env";
import {
  fetchAttLog,
  fetchLogCount,
  type DeviceTap,
} from "./sources/fingerprint";
import { normalizeNik } from "./sources/nik";
import { notify } from "./notify";
import { registeredNiks } from "./registered-niks";

/** The two questions a pass asks, injectable so the folding is tested dry. */
export type DeviceClient = {
  count: (ip: string) => Promise<number | null>;
  taps: (ip: string, comKey: number, port: number) => Promise<DeviceTap[]>;
};

const liveClient: DeviceClient = {
  count: (ip) => fetchLogCount(ip),
  taps: (ip, comKey) => fetchAttLog(ip, comKey),
};

export type CollectResult = {
  /** Machines considered — active, and standing in the operator booth. */
  asked: number;
  /** Machines whose log had grown and were therefore read. */
  pulled: number;
  /** Taps written. Replays land on the unique key and write nothing. */
  stored: number;
  /** Taps belonging to somebody our register does not carry. */
  unknownNik: number;
  /** Machines that would not say how many records they hold. */
  unreachable: number;
  /** Machines whose pull or store raised — counted, never fatal to the pass. */
  failed: number;
  /** Taps older than we keep, dropped before the insert rather than after. */
  stale: number;
};

/**
 * Rows per insert.
 *
 * Postgres binds at most 65,535 parameters per statement, and a tap costs five
 * of them. A machine replays its whole log on every pull, so a machine holding
 * 73,613 records hands us far more registered taps than one statement can
 * carry — and the failure is not a slow query, it is `MAX_PARAMETERS_EXCEEDED`
 * thrown before anything is written. Measured 2026-09-12: it killed the
 * morning's collection after a single partial pass.
 *
 * 5,000 leaves room for a column to be added without this having to be
 * re-derived.
 */
const INSERT_CHUNK = 5_000;

function chunks<T>(rows: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += INSERT_CHUNK)
    out.push(rows.slice(i, i + INSERT_CHUNK));
  return out;
}

/**
 * How long a tap is worth keeping here.
 *
 * Three days (owner). The machines hold months and remain the archive, so this
 * is a window for watching a muster rather than a record of the site's
 * attendance — and anything worth keeping longer leaves through the export.
 * The derived readings outlive it: losing the taps costs the ability to
 * re-derive, not the reading itself.
 */
const KEEP_DAYS = 3;

/**
 * The oldest tap worth writing down, as the machines spell time.
 *
 * A machine cannot be asked for a date range — four argument shapes were put
 * to one on 2026-09-12 and all four came back with the same 11,921 rows over
 * eighty days — so every pull hands us the whole history whether we want it or
 * not. What we can do is refuse to write it: we keep three days, so the other
 * seventy-seven were being inserted and then deleted again by the sweep at the
 * end of the same pass. On nineteen machines that is hundreds of thousands of
 * rows of pure waste per pass, and it is the first pass of a muster — the one
 * that has to finish quickly — that pays it.
 *
 * Compared as text. The machines send `"YYYY-MM-DD HH:MM:SS"` with no zone,
 * which sorts correctly as a string, and parsing it into a `Date` would bind
 * it to this process's zone for no gain.
 */
function oldestWorthKeeping(now = new Date()): string {
  const then = new Date(now.getTime() - KEEP_DAYS * 24 * 60 * 60 * 1000);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return (
    `${then.getFullYear()}-${p2(then.getMonth() + 1)}-${p2(then.getDate())} ` +
    `${p2(then.getHours())}:${p2(then.getMinutes())}:${p2(then.getSeconds())}`
  );
}

/**
 * The last count each machine gave us, by address.
 *
 * In memory on purpose, as the reference implementation does it. A restart
 * re-pulls each machine once and the unique key absorbs it; persisting these
 * would create a second thing to be true about a machine we can simply ask.
 */
const lastCount = new Map<string, number>();

/** Testing seam, and the manual "pull everything again" path. */
export function forgetCounts(): void {
  lastCount.clear();
}

/** Run `work` over `items`, at most `limit` at a time. */
async function mapPooled<T>(
  items: T[],
  limit: number,
  work: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (let i = next++; i < items.length; i = next++) await work(items[i]!);
    }
  );
  await Promise.all(runners);
}

export async function collectOnce(
  client: DeviceClient = liveClient
): Promise<CollectResult> {
  const machines = await db
    .select()
    .from(schema.fingerprintMachines)
    .where(
      and(
        eq(schema.fingerprintMachines.active, true),
        eq(schema.fingerprintMachines.operatorBooth, true)
      )
    );

  const result: CollectResult = {
    asked: machines.length,
    pulled: 0,
    stored: 0,
    unknownNik: 0,
    unreachable: 0,
    failed: 0,
    stale: 0,
  };
  if (!machines.length) return result;

  /* Who the register knows, read once for the whole pass rather than per tap.
     The machines carry 2,930 enrolled people against our 989. */
  const registered = await registeredNiks();

  /* Once for the pass, not once per tap. */
  const cutoff = oldestWorthKeeping();

  /* Bounded, like the prober's: fifty-eight connects at once was measured to
     push the slower machines past their own timeout. */
  await mapPooled(machines, env.PROBE_CONCURRENCY, async (machine) => {
    try {
      const count = await client.count(machine.ip);
      if (count === null) {
        /* A machine that will not answer is skipped, never fatal: the other
           thirty-two are still this morning's attendance. Its own count is left
           alone so the next pass tries again rather than assuming. */
        result.unreachable += 1;
        return;
      }

      const before = lastCount.get(machine.ip);
      if (before !== undefined && count <= before) return;

      const taps = await client.taps(machine.ip, machine.comKey, machine.port);
      result.pulled += 1;
      /* Recorded after the pull, not before: a pull that failed must not leave
         us believing we already have what it was holding. */
      lastCount.set(machine.ip, count);

      const keep = taps.flatMap((tap) => {
        if (tap.at < cutoff) {
          result.stale += 1;
          return [];
        }
        const nik = normalizeNik(tap.nik);
        if (!nik || !registered.has(nik)) {
          result.unknownNik += 1;
          return [];
        }
        return [
          {
            ip: machine.ip,
            nik,
            at: tap.at,
            direction: tap.direction,
            verified: tap.verified,
          },
        ];
      });
      if (!keep.length) return;

      /* Every pull replays the machine's whole log, so the conflict is the
         normal case rather than the exception — and the log is why this is
         chunked: one statement cannot bind a whole machine's history. */
      for (const slice of chunks(keep)) {
        const written = await db
          .insert(schema.deviceTaps)
          .values(slice)
          .onConflictDoNothing()
          .returning({ id: schema.deviceTaps.id });
        result.stored += written.length;
      }
    } catch (error) {
      /*
       * One machine cannot end the muster's collection.
       *
       * Before this, anything raised here rejected the pool, which threw out
       * of the pass, which ended the whole collection window — so a single
       * machine took the other nineteen down with it and the morning
       * collected nothing more. Counted and logged instead; the next pass is
       * thirty seconds away and its count was deliberately not recorded, so
       * that pass pulls it again.
       */
      result.failed += 1;
      console.error(`[taps] ${machine.ip} gagal pada pass ini`, error);
    }
  });

  /* Swept here rather than on a schedule of its own: collection already runs
     on a cadence, and a stage existing only to run one indexed delete would be
     more machinery than the problem. The same bargain `notify.ts` strikes. */
  if (result.stored)
    await db
      .delete(schema.deviceTaps)
      .where(
        lt(schema.deviceTaps.at, sql`now() - ${`${KEEP_DAYS} days`}::interval`)
      );

  return result;
}

/**
 * What every machine was holding, at one end of the muster.
 *
 * Reported when collection starts and again when it stops. Two numbers per
 * machine per shift is the whole of the watching: a log that shrank between
 * two consecutive reports is visible in the reports themselves, so nothing has
 * to sit there counting all day to notice it.
 *
 * The reading is a plain count, not a pull — a few hundred bytes per machine —
 * and it goes through the same client, so it appears in `device_requests` like
 * everything else we ask.
 */
export async function reportLogSizes(
  moment: DeviceReportMoment,
  client: DeviceClient = liveClient
): Promise<void> {
  const machines = await db
    .select({
      name: schema.fingerprintMachines.name,
      ip: schema.fingerprintMachines.ip,
    })
    .from(schema.fingerprintMachines)
    .where(
      and(
        eq(schema.fingerprintMachines.active, true),
        eq(schema.fingerprintMachines.operatorBooth, true)
      )
    );
  if (!machines.length) return;

  const sizes: { name: string; count: number | null }[] = [];
  await mapPooled(machines, env.PROBE_CONCURRENCY, async (machine) => {
    sizes.push({ name: machine.name, count: await client.count(machine.ip) });
  });
  sizes.sort((a, b) => a.name.localeCompare(b.name));

  /* One notification listing every machine rather than one per machine:
     thirty-three notifications twice a shift would bury the thing they are
     meant to make noticeable. */
  await notify("device-log-sizes", "info", {
    moment,
    at: new Date().toISOString(),
    machines: sizes,
  });
}
