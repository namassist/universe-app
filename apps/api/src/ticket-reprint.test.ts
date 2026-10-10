/**
 * A reprint can go to any active printer (owner, 2026-10-10).
 *
 * The night of 2026-10-10 most booth printers produced no paper and Mesin 20's
 * did; a reprint could only go back to the dead printer it first went to. So
 * the reprint takes a printer, defaults to the original, and the ticket then
 * records where its paper actually came out.
 *
 * The send is injected; nothing here reaches a printer.
 *
 * Needs the dev Postgres:
 *   bun --env-file=.env test src/ticket-reprint.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import type { TicketFields } from "./ticket-escpos";
import { reprintTicket } from "./ticket-issue";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Reprint ${uid()}`;

const made = { printers: [] as string[], tickets: [] as string[] };
let original = { id: "", ip: "198.51.100.211" };
let elsewhere = { id: "", ip: "198.51.100.212" };
let switchedOff = { id: "", ip: "198.51.100.213" };

const fields: TicketFields = {
  nik: "990099",
  name: "Uji Cetak Ulang",
  position: "Operator",
  department: "MINING OPERATION",
  seat: null,
  printerName: "MESIN UJI",
  at: "1999-04-04 16:31:00",
  role: "standing",
  ftw: null,
  hazards: [],
  safety: [],
};

async function printer(ip: string, active = true) {
  const [row] = await db
    .insert(schema.printers)
    .values({ name: `${tag} ${ip}`, ip, active })
    .returning({ id: schema.printers.id });
  made.printers.push(row!.id);
  return { id: row!.id, ip };
}

async function ticket() {
  const [row] = await db
    .insert(schema.tickets)
    .values({
      nik: fields.nik,
      date: "1999-04-04",
      shift: "night",
      ip: "198.51.100.11",
      printerId: original.id,
      status: "failed",
      contentHash: `${tag}-${uid()}`,
      preview: "uji",
      fields,
    })
    .returning({ id: schema.tickets.id });
  made.tickets.push(row!.id);
  return row!.id;
}

/** A send that records where it went. */
function fakePrint() {
  const went: string[] = [];
  return {
    went,
    print: async (target: { ip: string; port: number }) => {
      went.push(target.ip);
      return { sent: true as const, ms: 1 };
    },
  };
}

const deps = (print: ReturnType<typeof fakePrint>["print"]) => ({
  print,
  printingEnabled: true,
  retry: { forMs: 0, gapMs: 0 },
});

const printerOf = async (id: string) => {
  const [row] = await db
    .select({ printerId: schema.tickets.printerId })
    .from(schema.tickets)
    .where(eq(schema.tickets.id, id));
  return row!.printerId;
};

beforeAll(async () => {
  original = await printer(original.ip);
  elsewhere = await printer(elsewhere.ip);
  switchedOff = await printer(switchedOff.ip, false);
});

afterAll(async () => {
  if (made.tickets.length)
    await db
      .delete(schema.tickets)
      .where(inArray(schema.tickets.id, made.tickets));
  if (made.printers.length)
    await db
      .delete(schema.printers)
      .where(inArray(schema.printers.id, made.printers));
});

describe("where a reprint goes", () => {
  test("with no printer chosen, back to the one it first went to", async () => {
    const id = await ticket();
    const { went, print } = fakePrint();

    const result = await reprintTicket(id, deps(print));

    expect(result.reprinted).toBe(true);
    expect(went).toEqual([original.ip]);
    expect(await printerOf(id)).toBe(original.id);
  });

  test("to the printer chosen, and the ticket then names that printer", async () => {
    const id = await ticket();
    const { went, print } = fakePrint();

    const result = await reprintTicket(id, {
      ...deps(print),
      printerId: elsewhere.id,
    });

    expect(result.reprinted).toBe(true);
    expect(went).toEqual([elsewhere.ip]);
    expect(await printerOf(id)).toBe(elsewhere.id);
  });

  test("never to a printer switched off, nor one that does not exist", async () => {
    const id = await ticket();
    const { went, print } = fakePrint();

    const off = await reprintTicket(id, {
      ...deps(print),
      printerId: switchedOff.id,
    });
    const gone = await reprintTicket(id, {
      ...deps(print),
      printerId: crypto.randomUUID(),
    });

    expect(off).toEqual({ reprinted: false, reason: "printer_not_found" });
    expect(gone).toEqual({ reprinted: false, reason: "printer_not_found" });
    expect(went).toHaveLength(0);
    expect(await printerOf(id)).toBe(original.id);
  });
});
