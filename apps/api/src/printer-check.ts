/**
 * A test slip at every booth printer when the first finger opens.
 *
 * On 2026-10-10 most booth printers took their tickets — the screen said
 * "Tercetak" — and printed nothing, and nobody knew until operators stood at
 * the booth empty-handed. So at `finger-ingest`, when listening opens, every
 * active printer paired with an active machine is sent a short slip saying it
 * is a test (owner, 2026-10-10). The crew sees paper come out before the queue
 * does, or knows which printer to fix while there is still time.
 *
 * What this can know is the same as for a ticket: that the bytes were handed
 * to the printer and the connection closed cleanly. Whether paper came out is
 * the crew's to see — which is the point of printing it.
 *
 * One attempt per printer, no minute of retries: a test that waits a minute
 * per dead printer reports after the queue has formed.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { ShiftKind } from "@universe/contracts";

import { db, schema } from "./db";
import { env } from "./env";
import { notify } from "./notify";
import { renderTestSlip } from "./ticket-escpos";
import { sendToPrinter, type PrintOutcome } from "./ticket-printer";

type Send = (ip: string, port: number, bytes: Buffer) => Promise<PrintOutcome>;

export type PrinterCheck = {
  skipped: boolean;
  total: number;
  sent: number;
  /** Names of the machines whose printer could not be sent the slip. */
  failed: string[];
};

/** A few at a time: the site's links are shared with the live sessions. */
const IN_FLIGHT = 5;

const clockOf = (at: Date) =>
  `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;

type Target = {
  id: string;
  /** The name a failure is reported under. */
  name: string;
  ip: string;
  port: number;
  slip: Buffer;
};
type Miss = { id: string; name: string; ip: string; reason: string };

/** One slip to each target, a few at a time; the misses, with their reason. */
async function sendSlips(targets: Target[], send: Send): Promise<Miss[]> {
  const missed: Miss[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(IN_FLIGHT, targets.length) }, async () => {
      for (let i = next++; i < targets.length; i = next++) {
        const t = targets[i]!;
        const outcome = await send(t.ip, t.port, t.slip);
        if (!outcome.sent) {
          missed.push({
            id: t.id,
            name: t.name,
            ip: t.ip,
            reason: outcome.reason,
          });
          console.error(
            `[tes-printer] ${t.name} (${t.ip}) gagal: ${outcome.reason}`
          );
        }
      }
    })
  );
  return missed.sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

/** Printing switched off means no paper at all — a test slip included. */
const printingOn = (printing: boolean | undefined) => {
  const on = printing ?? env.TICKET_PRINTING;
  if (!on) console.log("[tes-printer] dilewati — TICKET_PRINTING mati");
  return on;
};

export async function runPrinterCheck(
  shift: ShiftKind,
  deps: { send?: Send; printing?: boolean; now?: Date } = {}
): Promise<PrinterCheck> {
  if (!printingOn(deps.printing))
    return { skipped: true, total: 0, sent: 0, failed: [] };

  const booths = await db
    .select({
      id: schema.printers.id,
      machine: schema.fingerprintMachines.name,
      ip: schema.printers.ip,
      port: schema.printers.port,
    })
    .from(schema.fingerprintMachines)
    .innerJoin(
      schema.printers,
      eq(schema.printers.id, schema.fingerprintMachines.printerId)
    )
    .where(
      and(
        eq(schema.fingerprintMachines.active, true),
        eq(schema.printers.active, true)
      )
    )
    .orderBy(schema.fingerprintMachines.name);

  const at = clockOf(deps.now ?? new Date());
  const missed = await sendSlips(
    booths.map((b) => ({
      id: b.id,
      name: b.machine,
      ip: b.ip,
      port: b.port,
      slip: renderTestSlip({ machine: b.machine, printerIp: b.ip, at, shift }),
    })),
    deps.send ?? sendToPrinter
  );

  const failed = missed.map((m) => m.name);
  const result: PrinterCheck = {
    skipped: false,
    total: booths.length,
    sent: booths.length - failed.length,
    failed,
  };
  console.log(
    `[tes-printer] shift ${shift}: ${result.sent}/${result.total} slip tes terkirim`
  );
  /* The reason stays in the log; the notice names booths, never errors. */
  await notify("printer-test", failed.length ? "danger" : "success", {
    shift,
    total: result.total,
    sent: result.sent,
    failed,
  });
  return result;
}

export type ManualPrinterTest = {
  skipped: boolean;
  total: number;
  sent: number;
  /** Each printer that could not be sent the slip, and why. */
  failed: Miss[];
};

/**
 * The same slip, sent by hand from the printer registry — to the printers
 * asked for, or every active one (owner, 2026-10-10). For checking a printer
 * before the timeline opens, or a new one before it is paired.
 *
 * An inactive printer is never sent to, even by name: a ticket never would
 * be. Answered to the person who pressed the button, reasons included, and no
 * notice written — the notifications page keeps to the scheduled test.
 */
export async function testPrinters(
  ids: string[] | undefined,
  deps: { send?: Send; printing?: boolean; now?: Date } = {}
): Promise<ManualPrinterTest> {
  if (!printingOn(deps.printing))
    return { skipped: true, total: 0, sent: 0, failed: [] };
  if (ids && ids.length === 0)
    return { skipped: false, total: 0, sent: 0, failed: [] };

  const printers = await db
    .select({
      id: schema.printers.id,
      name: schema.printers.name,
      ip: schema.printers.ip,
      port: schema.printers.port,
      machine: schema.fingerprintMachines.name,
    })
    .from(schema.printers)
    .leftJoin(
      schema.fingerprintMachines,
      eq(schema.fingerprintMachines.printerId, schema.printers.id)
    )
    .where(
      and(
        eq(schema.printers.active, true),
        ids ? inArray(schema.printers.id, ids) : undefined
      )
    )
    .orderBy(schema.printers.name);

  const at = clockOf(deps.now ?? new Date());
  const failed = await sendSlips(
    printers.map((p) => ({
      id: p.id,
      name: p.name,
      ip: p.ip,
      port: p.port,
      slip: renderTestSlip({
        machine: p.machine,
        printerName: p.name,
        printerIp: p.ip,
        at,
        shift: "manual",
      }),
    })),
    deps.send ?? sendToPrinter
  );
  console.log(
    `[tes-printer] manual: ${printers.length - failed.length}/${printers.length} slip tes terkirim`
  );
  return {
    skipped: false,
    total: printers.length,
    sent: printers.length - failed.length,
    failed,
  };
}
