/**
 * The reachability prober — the debounce, and the clock that must not drift.
 *
 * Every test injects a fake probe, so this suite never opens a socket: what is
 * under test is the folding of results into machine rows, not TCP itself.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/prober.test.ts
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

import { db, schema } from "./db";
import { probeOnce, type Probe } from "./prober";
import { redis } from "./redis";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Prober ${uid()}`;

/** Documentation range — never a real machine on site. */
const IP_UP = "203.0.113.201";
const IP_DOWN = "203.0.113.202";
const IP_OFF = "203.0.113.203";
const IP_PRINTER = "203.0.113.204";
const IP_PRINTER_LOOSE = "203.0.113.205";

const made: string[] = [];
const madePrinters: string[] = [];

/** A probe that answers from a set of reachable addresses. */
const probeWith =
  (reachable: Set<string>): Probe =>
  async (ip) =>
    reachable.has(ip);

async function makeMachine(
  name: string,
  ip: string,
  active = true,
  printerId: string | null = null
) {
  const [row] = await db
    .insert(schema.fingerprintMachines)
    .values({ name: `${tag} ${name}`, ip, active, printerId })
    .returning();
  made.push(row!.id);
  return row!;
}

async function makePrinter(ip: string, port = 9100) {
  const [row] = await db
    .insert(schema.printers)
    .values({ name: `${tag} PRINTER ${ip}`, ip, port })
    .returning();
  madePrinters.push(row!.id);
  return row!;
}

const readPrinter = async (id: string) => {
  const [row] = await db
    .select()
    .from(schema.printers)
    .where(eq(schema.printers.id, id))
    .limit(1);
  return row!;
};

const read = async (id: string) => {
  const [row] = await db
    .select()
    .from(schema.fingerprintMachines)
    .where(eq(schema.fingerprintMachines.id, id))
    .limit(1);
  return row!;
};

/** Probing runs behind a Redis lease; tests drive `probeOnce` directly. */
beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
});

async function cleanUp() {
  if (made.length) {
    await db
      .delete(schema.fingerprintMachines)
      .where(inArray(schema.fingerprintMachines.id, made));
    made.length = 0;
  }
  if (madePrinters.length) {
    await db
      .delete(schema.printers)
      .where(inArray(schema.printers.id, madePrinters));
    madePrinters.length = 0;
  }
}

beforeEach(cleanUp);
afterAll(cleanUp);

describe("the debounce", () => {
  test("a reachable machine comes online on the first cycle", async () => {
    const m = await makeMachine("UP", IP_UP);
    await probeOnce(probeWith(new Set([IP_UP])));

    const row = await read(m.id);
    expect(row.online).toBe(true);
    expect(row.missCount).toBe(0);
    expect(row.lastSeenAt).not.toBeNull();
    expect(row.checkedAt).not.toBeNull();
  });

  test("one miss does not take a machine offline", async () => {
    const m = await makeMachine("BLIP", IP_UP);
    await probeOnce(probeWith(new Set([IP_UP]))); // online
    await probeOnce(probeWith(new Set())); // one dropped packet

    const row = await read(m.id);
    expect(row.online).toBe(true);
    expect(row.missCount).toBe(1);
  });

  test("two consecutive misses do", async () => {
    const m = await makeMachine("GONE", IP_UP);
    await probeOnce(probeWith(new Set([IP_UP])));
    await probeOnce(probeWith(new Set()));
    await probeOnce(probeWith(new Set()));

    const row = await read(m.id);
    expect(row.online).toBe(false);
    expect(row.missCount).toBe(2);
  });

  test("a success resets the counter and restores the machine", async () => {
    const m = await makeMachine("BACK", IP_UP);
    await probeOnce(probeWith(new Set()));
    await probeOnce(probeWith(new Set()));
    expect((await read(m.id)).online).toBe(false);

    await probeOnce(probeWith(new Set([IP_UP])));
    const row = await read(m.id);
    expect(row.online).toBe(true);
    expect(row.missCount).toBe(0);
  });
});

describe("status_since", () => {
  test("does not move while the status is unchanged", async () => {
    // The wall says "offline 2 j 14 m" from this column; a value rewritten
    // every cycle would reset that to zero once a minute.
    const m = await makeMachine("STEADY", IP_UP);
    await probeOnce(probeWith(new Set([IP_UP])));
    const first = (await read(m.id)).statusSince;

    await probeOnce(probeWith(new Set([IP_UP])));
    await probeOnce(probeWith(new Set([IP_UP])));

    expect((await read(m.id)).statusSince?.getTime()).toBe(first?.getTime());
  });

  test("moves when the status flips", async () => {
    const m = await makeMachine("FLIP", IP_UP);
    await probeOnce(probeWith(new Set([IP_UP])));
    const online = (await read(m.id)).statusSince;

    await probeOnce(probeWith(new Set()));
    await probeOnce(probeWith(new Set()));
    const offline = (await read(m.id)).statusSince;

    expect(offline!.getTime()).toBeGreaterThan(online!.getTime());
  });

  test("last_seen_at holds the last real contact, not the last attempt", async () => {
    const m = await makeMachine("LAST", IP_UP);
    await probeOnce(probeWith(new Set([IP_UP])));
    const seen = (await read(m.id)).lastSeenAt;

    await probeOnce(probeWith(new Set()));
    const row = await read(m.id);

    expect(row.lastSeenAt?.getTime()).toBe(seen?.getTime());
    // …while checked_at keeps moving, which is what makes `online` legible
    // as fresh rather than merely old.
    expect(row.checkedAt!.getTime()).toBeGreaterThanOrEqual(seen!.getTime());
  });
});

describe("what gets probed", () => {
  test("an inactive machine is never probed and never reported", async () => {
    const m = await makeMachine("RETIRED", IP_OFF, false);
    const asked: string[] = [];
    await probeOnce(async (ip) => {
      asked.push(ip);
      return true;
    });

    expect(asked).not.toContain(IP_OFF);
    const row = await read(m.id);
    expect(row.checkedAt).toBeNull();
    expect(row.online).toBe(false);
  });

  test("every active machine is probed in one cycle", async () => {
    await makeMachine("A", IP_UP);
    await makeMachine("B", IP_DOWN);
    const asked: string[] = [];
    const result = await probeOnce(async (ip) => {
      asked.push(ip);
      return ip === IP_UP;
    });

    expect(asked).toContain(IP_UP);
    expect(asked).toContain(IP_DOWN);
    expect(result.probed).toBeGreaterThanOrEqual(2);
  });
});

/*
 * The printer is half of a booth: a machine that answers with a dead printer
 * records the tap and never hands out the slip. Every screen used to call such
 * a machine "online" (2026-10-10), so the printer is probed in the same cycle.
 */
describe("the booth's printer", () => {
  test("a paired printer is probed on its own port, and comes online", async () => {
    const printer = await makePrinter(IP_PRINTER, 9101);
    await makeMachine("PAIRED", IP_UP, true, printer.id);
    const asked: string[] = [];

    const result = await probeOnce(async (ip, port) => {
      asked.push(`${ip}:${port}`);
      return true;
    });

    expect(asked).toContain(`${IP_PRINTER}:9101`);
    const row = await readPrinter(printer.id);
    expect(row.online).toBe(true);
    expect(row.checkedAt).not.toBeNull();
    expect(row.lastSeenAt).not.toBeNull();
    expect(result.printersProbed).toBeGreaterThanOrEqual(1);
  });

  test("a printer goes offline after the same two misses as a machine", async () => {
    const printer = await makePrinter(IP_PRINTER);
    await makeMachine("PAIRED", IP_UP, true, printer.id);
    const machineOnly = probeWith(new Set([IP_UP]));

    await probeOnce(probeWith(new Set([IP_UP, IP_PRINTER])));
    await probeOnce(machineOnly);
    expect((await readPrinter(printer.id)).online).toBe(true);

    await probeOnce(machineOnly);
    const row = await readPrinter(printer.id);
    expect(row.online).toBe(false);
    expect(row.missCount).toBe(2);
  });

  test("a printer whose machine is inactive, or that no machine uses, is left alone", async () => {
    const retired = await makePrinter(IP_PRINTER);
    await makeMachine("RETIRED", IP_OFF, false, retired.id);
    const loose = await makePrinter(IP_PRINTER_LOOSE);
    const asked: string[] = [];

    await probeOnce(async (ip) => {
      asked.push(ip);
      return true;
    });

    expect(asked).not.toContain(IP_PRINTER);
    expect(asked).not.toContain(IP_PRINTER_LOOSE);
    expect((await readPrinter(retired.id)).checkedAt).toBeNull();
    expect((await readPrinter(loose.id)).checkedAt).toBeNull();
  });

  test("a machine is probed on the ZK port", async () => {
    await makeMachine("ZK", IP_UP);
    const asked: string[] = [];
    await probeOnce(async (ip, port) => {
      asked.push(`${ip}:${port}`);
      return true;
    });
    expect(asked).toContain(`${IP_UP}:4370`);
  });
});
