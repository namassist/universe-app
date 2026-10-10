/**
 * The test slip at the first finger: every booth printer is sent one, so the
 * crew sees paper come out before the queue does (owner, 2026-10-10).
 *
 * The send is injected, so nothing here reaches a printer. Other active
 * machines in the test database may be paired too; assertions are about the
 * rows these tests made.
 *
 * Needs the dev Postgres:
 *   bun --env-file=.env test src/printer-check.test.ts
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import { runPrinterCheck } from "./printer-check";
import type { PrintOutcome } from "./ticket-printer";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ TesCetak ${uid()}`;
/** Documentation range — never a real device on site. */
const ip = (last: number) => `198.51.100.${last}`;

const made = { machines: [] as string[], printers: [] as string[] };
let since = new Date();

async function booth(
  last: number,
  options: { machineActive?: boolean; printerActive?: boolean } = {}
) {
  const [printer] = await db
    .insert(schema.printers)
    .values({
      name: `${tag} P${last}`,
      ip: ip(100 + last),
      active: options.printerActive ?? true,
    })
    .returning({ id: schema.printers.id });
  made.printers.push(printer!.id);
  const [machine] = await db
    .insert(schema.fingerprintMachines)
    .values({
      name: `${tag} M${last}`,
      ip: ip(last),
      active: options.machineActive ?? true,
      printerId: printer!.id,
    })
    .returning({ id: schema.fingerprintMachines.id });
  made.machines.push(machine!.id);
  return { printerIp: ip(100 + last), name: `${tag} M${last}` };
}

/** A send that records where it went and fails for the addresses given. */
function fakeSend(failFor: string[] = []) {
  const sent: { ip: string; text: string }[] = [];
  const send = async (
    to: string,
    _port: number,
    bytes: Buffer
  ): Promise<PrintOutcome> => {
    sent.push({ ip: to, text: bytes.toString("latin1") });
    return failFor.includes(to)
      ? { sent: false, reason: "ECONNREFUSED", ms: 1 }
      : { sent: true, ms: 1 };
  };
  return { send, sent };
}

const lastNotice = async () => {
  const [row] = await db
    .select()
    .from(schema.notifications)
    .where(
      and(
        eq(schema.notifications.kind, "printer-test"),
        gte(schema.notifications.createdAt, since)
      )
    )
    .orderBy(desc(schema.notifications.createdAt))
    .limit(1);
  return row;
};

async function cleanUp() {
  if (made.machines.length)
    await db
      .delete(schema.fingerprintMachines)
      .where(inArray(schema.fingerprintMachines.id, made.machines));
  if (made.printers.length)
    await db
      .delete(schema.printers)
      .where(inArray(schema.printers.id, made.printers));
  made.machines = [];
  made.printers = [];
  await db
    .delete(schema.notifications)
    .where(
      and(
        eq(schema.notifications.kind, "printer-test"),
        gte(schema.notifications.createdAt, since)
      )
    );
}

beforeEach(async () => {
  await cleanUp();
  since = new Date();
});
afterAll(cleanUp);

describe("who is sent a test slip", () => {
  test("every active printer of an active machine, once each", async () => {
    const a = await booth(1);
    const b = await booth(2);
    const { send, sent } = fakeSend();

    await runPrinterCheck("night", { send, printing: true });

    const ips = sent.map((s) => s.ip);
    expect(ips.filter((x) => x === a.printerIp)).toHaveLength(1);
    expect(ips.filter((x) => x === b.printerIp)).toHaveLength(1);
    const slip = sent.find((s) => s.ip === a.printerIp)!.text;
    expect(slip).toContain("TES PRINTER");
    expect(slip).toContain(a.name);
  });

  test("not a printer whose machine is inactive, nor an inactive printer", async () => {
    const off = await booth(3, { machineActive: false });
    const unused = await booth(4, { printerActive: false });
    const { send, sent } = fakeSend();

    await runPrinterCheck("day", { send, printing: true });

    const ips = sent.map((s) => s.ip);
    expect(ips).not.toContain(off.printerIp);
    expect(ips).not.toContain(unused.printerIp);
  });

  /* Printing switched off means no paper at all — a test slip included. */
  test("nothing is sent while ticket printing is switched off", async () => {
    await booth(5);
    const { send, sent } = fakeSend();

    const result = await runPrinterCheck("night", { send, printing: false });

    expect(sent).toHaveLength(0);
    expect(result.skipped).toBe(true);
  });
});

describe("what it reports", () => {
  test("a booth whose slip could not be sent is named, and the notice is red", async () => {
    await booth(6);
    const bad = await booth(7);
    const { send } = fakeSend([bad.printerIp]);

    const result = await runPrinterCheck("night", { send, printing: true });

    expect(result.failed).toContain(bad.name);
    const notice = await lastNotice();
    expect(notice?.tone).toBe("danger");
    expect((notice?.params as { failed: string[] }).failed).toContain(bad.name);
    expect((notice?.params as { shift: string }).shift).toBe("night");
  });

  test("when every slip went out, the notice is green and counts them", async () => {
    await booth(8);
    const { send } = fakeSend();

    const result = await runPrinterCheck("day", { send, printing: true });

    expect(result.failed).toHaveLength(0);
    const notice = await lastNotice();
    expect(notice?.tone).toBe("success");
    const params = notice?.params as { total: number; sent: number };
    expect(params.sent).toBe(params.total);
    expect(params.total).toBeGreaterThanOrEqual(1);
  });
});
