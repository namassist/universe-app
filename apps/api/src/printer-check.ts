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

import { and, eq } from "drizzle-orm";
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

export async function runPrinterCheck(
  shift: ShiftKind,
  deps: { send?: Send; printing?: boolean; now?: Date } = {}
): Promise<PrinterCheck> {
  const send = deps.send ?? sendToPrinter;
  /* Printing switched off means no paper at all — a test slip included. */
  if (!(deps.printing ?? env.TICKET_PRINTING)) {
    console.log("[tes-printer] dilewati — TICKET_PRINTING mati");
    return { skipped: true, total: 0, sent: 0, failed: [] };
  }

  const booths = await db
    .select({
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
  const failed: string[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(IN_FLIGHT, booths.length) }, async () => {
      for (let i = next++; i < booths.length; i = next++) {
        const booth = booths[i]!;
        const outcome = await send(
          booth.ip,
          booth.port,
          renderTestSlip({
            machine: booth.machine,
            printerIp: booth.ip,
            at,
            shift,
          })
        );
        if (!outcome.sent) {
          failed.push(booth.machine);
          console.error(
            `[tes-printer] ${booth.machine} (${booth.ip}) gagal: ${outcome.reason}`
          );
        }
      }
    })
  );

  failed.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
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
