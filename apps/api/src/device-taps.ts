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

import { and, eq } from "drizzle-orm";
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
};

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
  };
  if (!machines.length) return result;

  /* Who the register knows, read once for the whole pass rather than per tap.
     The machines carry 2,930 enrolled people against our 989. */
  const registered = new Set(
    (await db.select({ nik: schema.employees.nik }).from(schema.employees)).map(
      (r) => normalizeNik(r.nik)
    )
  );

  /* Bounded, like the prober's: fifty-eight connects at once was measured to
     push the slower machines past their own timeout. */
  await mapPooled(machines, env.PROBE_CONCURRENCY, async (machine) => {
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
       normal case rather than the exception. */
    const written = await db
      .insert(schema.deviceTaps)
      .values(keep)
      .onConflictDoNothing()
      .returning({ id: schema.deviceTaps.id });
    result.stored += written.length;
  });

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
