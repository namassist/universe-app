/**
 * Issuing a ticket end to end, minus the printer.
 *
 * The decision and the layout have their own suites; what is proven here is
 * the order of operations — that the row is claimed before anything prints, so
 * a double tap cannot produce two slips, and that a refused printer leaves a
 * failed row somebody can act on rather than a silence.
 *
 * Needs the dev Postgres and a seeded register:
 *   bun --env-file=.env test src/ticket-issue.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { firstTapOf, issueTicket } from "./ticket-issue";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Tiket ${uid()}`;
const ip = `203.0.113.${90 + Math.floor(Math.random() * 8)}`;

const made = {
  machines: [] as string[],
  printers: [] as string[],
  niks: [] as string[],
};
let nik = "";

beforeAll(async () => {
  const [person] = await db
    .select({ nik: schema.employees.nik })
    .from(schema.employees)
    .limit(1);
  nik = person?.nik ?? "";
  expect(nik).not.toBe("");
  made.niks.push(nik);

  const [printer] = await db
    .insert(schema.printers)
    .values({ name: `${tag} PRINTER`, ip: "203.0.113.200" })
    .returning({ id: schema.printers.id });
  made.printers.push(printer!.id);

  const [machine] = await db
    .insert(schema.fingerprintMachines)
    .values({ name: tag, ip, printerId: printer!.id, universeOnly: true })
    .returning({ id: schema.fingerprintMachines.id });
  made.machines.push(machine!.id);
});

afterAll(async () => {
  if (made.niks.length)
    await db
      .delete(schema.tickets)
      .where(inArray(schema.tickets.nik, made.niks));
  if (made.machines.length)
    await db
      .delete(schema.fingerprintMachines)
      .where(inArray(schema.fingerprintMachines.id, made.machines));
  if (made.printers.length)
    await db
      .delete(schema.printers)
      .where(inArray(schema.printers.id, made.printers));
});

/** A tap late enough in the morning that a spare is past the second finger. */
const tapOn = (date: string) => ({
  ip,
  nik,
  at: `${date} 05:40:00`,
  date,
  shift: "day" as const,
});

describe("issuing", () => {
  test("renders and stores a ticket without printing when printing is off", async () => {
    const result = await issueTicket(tapOn("2026-01-02"), {
      printingEnabled: false,
    });
    expect(result.issued).toBe(true);
    if (!result.issued) return;
    expect(result.status).toBe("dry");
    expect(result.preview).toContain("BUKTI ABSEN MASUK");
    expect(result.preview).toContain(nik);
    /* The arrival is on the slip whether or not a unit is. */
    expect(result.preview).toContain("JAM ABSEN      : 2026-01-02 05:40:00");
  });

  /*
   * The claim is what makes a double tap safe. Both calls carry the same
   * contents, so the database refuses the second — not a timer, not a lock.
   */
  test("the same slip is not issued twice", async () => {
    await issueTicket(tapOn("2026-01-03"), { printingEnabled: false });
    const again = await issueTicket(tapOn("2026-01-03"), {
      printingEnabled: false,
    });
    expect(again).toEqual({ issued: false, reason: "duplicate" });
  });

  test("a nik the register does not carry is refused", async () => {
    const result = await issueTicket(
      { ...tapOn("2026-01-04"), nik: "000000000" },
      { printingEnabled: false }
    );
    expect(result).toEqual({ issued: false, reason: "unknown-person" });
  });
});

describe("when a printer is involved", () => {
  test("a printer that accepts leaves a printed row", async () => {
    const result = await issueTicket(tapOn("2026-01-05"), {
      printingEnabled: true,
      print: async () => ({ sent: true, ms: 12 }),
    });
    expect(result.issued && result.status).toBe("printed");

    const [row] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.date, "2026-01-05"));
    expect(row?.status).toBe("printed");
    expect(row?.printedAt).not.toBeNull();
  });

  /*
   * A refused printer must leave something a person can act on. The tap was
   * still attendance; only the paper is missing.
   */
  test("a printer that refuses leaves a failed row with the reason", async () => {
    const result = await issueTicket(tapOn("2026-01-06"), {
      printingEnabled: true,
      print: async () => ({ sent: false, reason: "ECONNREFUSED", ms: 4 }),
      /* The minute the owner asked for, compressed: what is under test is that
         it retries and then stops, not how long it waits. */
      retry: { forMs: 150, gapMs: 30 },
    });
    expect(result.issued && result.status).toBe("failed");

    const [row] = await db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.date, "2026-01-06"));
    expect(row?.status).toBe("failed");
    expect(row?.lastError).toBe("ECONNREFUSED");
    expect(row?.printedAt).toBeNull();
    /* Tried more than once inside its minute. */
    expect(row?.attempts).toBeGreaterThan(1);
  });
});

/**
 * Which reader caught the first finger must not change the arrival.
 *
 * The live session hears a tap in about a second; the periodic pull finds it
 * within half a minute. Either can miss one — a session that dropped, a
 * machine nobody is listening to — and before this the arrival was read from
 * the live events alone. A spare whose first finger went unheard had his
 * second finger printed as his arrival, which is past the deadline, which
 * costs him the unit on his slip.
 */
describe("the first tap of the shift", () => {
  const day = "2026-01-08";

  afterAll(async () => {
    await db.delete(schema.deviceTaps).where(eq(schema.deviceTaps.ip, ip));
    await db
      .delete(schema.deviceLiveEvents)
      .where(eq(schema.deviceLiveEvents.ip, ip));
  });

  test("is found in the pulled taps when the live session missed it", async () => {
    /* Only the pull has the 04:41 tap; the live session joined later. */
    await db
      .insert(schema.deviceTaps)
      .values({ ip, nik, at: `${day} 04:41:00`, direction: "in" });

    expect(await firstTapOf(nik, day, "day")).toBe(`${day} 04:41:00`);
  });

  test("is the earliest across both readers, not the earliest of one", async () => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik, at: `${day} 04:39:00` });

    expect(await firstTapOf(nik, day, "day")).toBe(`${day} 04:39:00`);
  });

  test("ignores a tap belonging to the other shift", async () => {
    await db
      .insert(schema.deviceLiveEvents)
      .values({ ip, nik, at: `${day} 17:05:00` });

    expect(await firstTapOf(nik, day, "day")).toBe(`${day} 04:39:00`);
    expect(await firstTapOf(nik, day, "night")).toBe(`${day} 17:05:00`);
  });
});
