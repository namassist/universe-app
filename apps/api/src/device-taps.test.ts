/**
 * One collection pass: ask, pull only what grew, keep only who we know.
 *
 * The three behaviours here are the ones that decide whether collecting from
 * thirty-odd machines on a short cadence is affordable and safe. A pass that
 * pulled unconditionally would move 2.58 MB per machine per cycle; a pass that
 * stopped at the first unreachable machine would lose a morning to one dead
 * radio link; a pass that was not idempotent would multiply one morning by
 * however many times it ran, because every pull replays a machine's whole log.
 *
 * Needs the dev Postgres:
 *   bun --env-file=.env test src/device-taps.test.ts
 */

import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { collectOnce, forgetCounts, type DeviceClient } from "./device-taps";
import { db, schema } from "./db";
import type { DeviceTap } from "./sources/fingerprint";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Tap ${uid()}`;

const made = {
  machines: [] as string[],
  employees: [] as string[],
  ips: [] as string[],
};

/** A NIK the register knows, and one it does not. */
let known = "";
const unknown = "999999999";

async function addMachine(ip: string, booth = true, active = true) {
  const [row] = await db
    .insert(schema.fingerprintMachines)
    .values({ name: `${tag} ${ip}`, ip, operatorBooth: booth, active })
    .returning({ id: schema.fingerprintMachines.id });
  made.machines.push(row!.id);
  made.ips.push(ip);
  return ip;
}

/** Local wall-clock text, the way the machines spell it. */
const wallClock = (ms: number) => {
  const d = new Date(ms);
  const p2 = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ` +
    `${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
  );
};

const tap = (nik: string, at: string): DeviceTap => ({
  nik,
  at,
  direction: "in",
  verified: 1,
});

/** A client that answers from a script rather than from the network. */
function fake(
  script: Record<string, { count: number | null; taps: DeviceTap[] }>
) {
  const pulled: string[] = [];
  const client: DeviceClient = {
    count: async (ip) => script[ip]?.count ?? null,
    taps: async (ip) => {
      pulled.push(ip);
      return script[ip]?.taps ?? [];
    },
  };
  return { client, pulled };
}

const storedFor = (ip: string) =>
  db.select().from(schema.deviceTaps).where(eq(schema.deviceTaps.ip, ip));

/* One real operator, borrowed from the register rather than invented, so the
   "known NIK" case exercises the join we actually ship. */
beforeAll(async () => {
  const [first] = await db
    .select({ nik: schema.employees.nik })
    .from(schema.employees)
    .limit(1);
  known = first?.nik ?? "";
  expect(known).not.toBe("");
});

beforeEach(async () => {
  forgetCounts();
  if (made.ips.length)
    await db
      .delete(schema.deviceTaps)
      .where(inArray(schema.deviceTaps.ip, made.ips));
});

afterAll(async () => {
  if (made.ips.length)
    await db
      .delete(schema.deviceTaps)
      .where(inArray(schema.deviceTaps.ip, made.ips));
  if (made.machines.length)
    await db
      .delete(schema.fingerprintMachines)
      .where(inArray(schema.fingerprintMachines.id, made.machines));
  if (made.employees.length)
    await db
      .delete(schema.employees)
      .where(inArray(schema.employees.id, made.employees));
});

describe("asking before pulling", () => {
  test("a machine whose log has grown is pulled", async () => {
    const ip = await addMachine(`10.90.${uid().slice(0, 2)}.1`);
    const { client, pulled } = fake({
      [ip]: { count: 3, taps: [tap(known, "2026-09-11 04:10:00")] },
    });

    const result = await collectOnce(client);

    expect(pulled).toContain(ip);
    expect(result.stored).toBeGreaterThanOrEqual(1);
  });

  /* The whole reason a short cadence is affordable. A production machine
     answers 2.58 MB to a pull and a few hundred bytes to a count. */
  test("a machine whose count has not moved is not pulled again", async () => {
    const ip = await addMachine(`10.91.${uid().slice(0, 2)}.1`);
    const script = {
      [ip]: { count: 3, taps: [tap(known, "2026-09-11 04:11:00")] },
    };

    const first = fake(script);
    await collectOnce(first.client);
    expect(first.pulled).toContain(ip);

    const second = fake(script);
    await collectOnce(second.client);

    expect(second.pulled).not.toContain(ip);
  });

  test("a count that cannot be read means the machine is skipped, not pulled", async () => {
    const ip = await addMachine(`10.92.${uid().slice(0, 2)}.1`);
    const { client, pulled } = fake({ [ip]: { count: null, taps: [] } });

    const result = await collectOnce(client);

    expect(pulled).not.toContain(ip);
    expect(result.unreachable).toBeGreaterThanOrEqual(1);
  });
});

describe("one machine's trouble is not the morning's", () => {
  test("the others are still collected", async () => {
    const dead = await addMachine(`10.93.${uid().slice(0, 2)}.1`);
    const alive = await addMachine(`10.93.${uid().slice(0, 2)}.2`);
    const { client } = fake({
      [dead]: { count: null, taps: [] },
      [alive]: { count: 1, taps: [tap(known, "2026-09-11 04:12:00")] },
    });

    await collectOnce(client);

    expect(await storedFor(alive)).toHaveLength(1);
  });
});

describe("which taps are kept", () => {
  test("a NIK the register does not know is dropped", async () => {
    const ip = await addMachine(`10.94.${uid().slice(0, 2)}.1`);
    const { client } = fake({
      [ip]: {
        count: 2,
        taps: [
          tap(known, "2026-09-11 04:13:00"),
          tap(unknown, "2026-09-11 04:13:30"),
        ],
      },
    });

    const result = await collectOnce(client);

    const rows = await storedFor(ip);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nik).toBe(known);
    expect(result.unknownNik).toBe(1);
  });

  /* Every pull replays the machine's whole log, so this is not an
     optimisation — it is what stands between one morning and thirty copies. */
  test("replaying the same log stores it once", async () => {
    const ip = await addMachine(`10.95.${uid().slice(0, 2)}.1`);
    const taps = [tap(known, "2026-09-11 04:14:00")];

    await collectOnce(fake({ [ip]: { count: 1, taps } }).client);
    forgetCounts();
    await collectOnce(fake({ [ip]: { count: 1, taps } }).client);

    expect(await storedFor(ip)).toHaveLength(1);
  });

  test("a machine outside the operator booth is never asked", async () => {
    const ip = await addMachine(`10.96.${uid().slice(0, 2)}.1`, false);
    const { client, pulled } = fake({ [ip]: { count: 5, taps: [] } });

    await collectOnce(client);

    expect(pulled).not.toContain(ip);
    expect(await storedFor(ip)).toHaveLength(0);
  });

  test("an inactive machine is never asked", async () => {
    const ip = await addMachine(`10.97.${uid().slice(0, 2)}.1`, true, false);
    const { client, pulled } = fake({ [ip]: { count: 5, taps: [] } });

    await collectOnce(client);

    expect(pulled).not.toContain(ip);
  });
});

/**
 * What one bad machine is allowed to cost.
 *
 * Both of these are regressions from the morning of 2026-09-12, when
 * collection ran for twenty-six seconds and then stopped without a word. Two
 * machines' taps had landed; the other seventeen never did, the derived
 * readings were never rebuilt, and the three-day sweep never ran — and nothing
 * looked wrong, because the board still reads the Nakula readings.
 */
describe("a pass that meets trouble", () => {
  /*
   * Postgres binds at most 65,535 parameters per statement and a tap costs
   * five, so a single insert tops out at 13,106 rows. A machine replays its
   * entire log on every pull — 73,613 records on the largest here — so this is
   * not an edge case, it is every morning on a busy machine. Unchunked it
   * raised MAX_PARAMETERS_EXCEEDED before writing anything at all.
   */
  test("a machine holding more taps than one statement can bind is stored whole", async () => {
    const ip = await addMachine(`10.98.${uid().slice(0, 2)}.1`);
    /* Inside the three-day window, and stepped by five seconds so fourteen
       thousand of them still fit in it. Dated any older they are dropped
       before the insert and the test measures the wrong thing. */
    const base = Date.now() - 6 * 60 * 60 * 1000;
    const taps = Array.from({ length: 14_000 }, (_, i) =>
      tap(known, wallClock(base + i * 5_000))
    );

    const result = await collectOnce(fake({ [ip]: { count: 1, taps } }).client);

    expect(result.stored).toBe(14_000);
    expect(await storedFor(ip)).toHaveLength(14_000);
  });

  /*
   * The machines cannot be asked for a date range — four argument shapes were
   * put to one on 2026-09-12 and all four returned the same eighty days — so
   * the whole history arrives every pull. Writing it and then sweeping it is
   * hundreds of thousands of wasted rows per pass, paid by the first pass of
   * the muster, which is the one that has to finish quickly.
   */
  test("taps older than the retention window are never written", async () => {
    const ip = await addMachine(`10.97.${uid().slice(0, 2)}.5`);
    const old = tap(known, "2026-06-25 04:30:00");
    const fresh = tap(known, wallClock(Date.now() - 60 * 60 * 1000));

    const result = await collectOnce(
      fake({ [ip]: { count: 2, taps: [old, fresh] } }).client
    );

    expect(result.stale).toBe(1);
    expect(result.stored).toBe(1);
    const rows = await storedFor(ip);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.at).toBe(fresh.at);
  });

  test("a machine that raises does not stop the ones beside it", async () => {
    const bad = await addMachine(`10.99.${uid().slice(0, 2)}.1`);
    const good = await addMachine(`10.99.${uid().slice(0, 2)}.2`);
    const client: DeviceClient = {
      count: async () => 5,
      taps: async (ip) => {
        if (ip === bad) throw new Error("mesin ini meledak");
        return [tap(known, "2026-09-11 04:12:00")];
      },
    };

    const result = await collectOnce(client);

    expect(result.failed).toBe(1);
    expect(await storedFor(bad)).toHaveLength(0);
    expect(await storedFor(good)).toHaveLength(1);
  });
});
