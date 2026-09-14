/**
 * From a tap to a slip: resolve, decide, render, record, print.
 *
 * The decision and the layout live in `ticket-rules.ts` and `ticket-escpos.ts`,
 * both pure. This is the part that has to ask the database who somebody is and
 * what they hold, and it is written so the order cannot be got wrong:
 *
 *   1. resolve — who tapped, what seat they hold, how they were judged
 *   2. decide  — `ticketFor`, the owner's table
 *   3. claim   — insert the ticket row first, unique on its contents
 *   4. print   — only if the claim was new, and only if printing is on
 *
 * **The claim comes before the paper.** Two taps a second apart would otherwise
 * both find no ticket and both print one; letting the database refuse the
 * second is the only version of this that holds under a double tap.
 *
 * **Nothing here may throw into the tap path.** A tap is attendance whatever
 * happens to a printer; the worst outcome is a row marked failed and a reprint
 * waiting for somebody to press it.
 */

import { and, eq, sql } from "drizzle-orm";
import type { ShiftKind } from "@universe/contracts";

import { db, schema } from "./db";
import { env } from "./env";
import { fingerInDeadline, ftwDeadline, judge } from "./readiness";
import { activeNotices } from "./safety-notices";
import { stageTimeOf } from "./stage-time";
import { ticketFor, type Seat, type TicketRole } from "./ticket-rules";
import {
  renderTicket,
  ticketPreview,
  type TicketFields,
} from "./ticket-escpos";
import { printWithRetry, sendToPrinter } from "./ticket-printer";

/** Noon splits the day, the same way `shiftIn` splits a reading. */
const inShift = (clock: string, shift: ShiftKind) =>
  shift === "night" ? clock >= "12:00:00" : clock < "12:00:00";

/**
 * The seat the paper should name, and whether FTW is asked for it.
 *
 * The generated board first, the standing plan second. That order is the whole
 * of the rule: before `spare-validate` has run there is no board, so a standing
 * operator's first-finger slip can only come from the plan — printed as it
 * stands, because making unit status final at 04:00 is the admin's job
 * (owner, 2026-09-13).
 */
export async function seatOf(
  nik: string,
  date: string,
  shift: ShiftKind
): Promise<{ seat: Seat; requiresFtw: boolean } | null> {
  const [fromBoard] = await db
    .select({
      unit: schema.units.code,
      bus: schema.fleetActualSlots.transportCode,
      area: schema.fleetActualSlots.workArea,
      fleet: schema.fleetActualFleets.leaderCode,
      requiresFtw: schema.units.ftw,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.fleetActualDocuments,
      eq(schema.fleetActualDocuments.id, schema.fleetActualSlots.documentId)
    )
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetActualSlots.employeeId)
    )
    .innerJoin(
      schema.units,
      eq(schema.units.id, schema.fleetActualSlots.unitId)
    )
    .leftJoin(
      schema.fleetActualFleets,
      eq(schema.fleetActualFleets.id, schema.fleetActualSlots.boardFleetId)
    )
    .where(
      and(
        eq(schema.fleetActualDocuments.date, date),
        eq(schema.fleetActualDocuments.shift, shift),
        eq(schema.employees.nik, nik)
      )
    )
    .limit(1);

  if (fromBoard)
    return {
      seat: {
        unit: fromBoard.unit,
        bus: fromBoard.bus,
        fleet: fromBoard.fleet,
        area: fromBoard.area,
      },
      requiresFtw: fromBoard.requiresFtw,
    };

  /* The plan: their standing unit, its transport and area, and the formation
     it belongs to, named by its leader unit the way the board names one. */
  const leader = db
    .select({
      unitId: schema.fleetUnits.unitId,
      leaderCode: sql<string>`leader.code`.as("leader_code"),
    })
    .from(schema.fleetUnits)
    .innerJoin(schema.fleets, eq(schema.fleets.id, schema.fleetUnits.fleetId))
    .innerJoin(
      sql`${schema.units} as leader`,
      sql`leader.id = ${schema.fleets.leaderUnitId}`
    )
    .as("leader");

  const [fromPlan] = await db
    .select({
      unit: schema.units.code,
      area: schema.units.workArea,
      bus: sql<string | null>`transport.code`,
      fleet: leader.leaderCode,
      requiresFtw: schema.units.ftw,
    })
    .from(schema.fleetPlanSlots)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .innerJoin(schema.units, eq(schema.units.id, schema.fleetPlanSlots.unitId))
    .leftJoin(
      sql`${schema.units} as transport`,
      sql`transport.id = ${schema.units.transportUnitId}`
    )
    .leftJoin(leader, eq(leader.unitId, schema.units.id))
    .where(eq(schema.employees.nik, nik))
    .limit(1);

  if (!fromPlan) return null;
  return {
    seat: {
      unit: fromPlan.unit,
      bus: fromPlan.bus ?? null,
      fleet: fromPlan.fleet ?? null,
      area: fromPlan.area ?? null,
    },
    requiresFtw: fromPlan.requiresFtw,
  };
}

/** Standing operators hold a unit in the plan. Everybody else is a spare. */
export async function roleOf(nik: string): Promise<TicketRole> {
  const [held] = await db
    .select({ id: schema.fleetPlanSlots.id })
    .from(schema.fleetPlanSlots)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.fleetPlanSlots.employeeId)
    )
    .where(eq(schema.employees.nik, nik))
    .limit(1);
  return held ? "standing" : "spare";
}

/**
 * The first tap of this shift, as the machine spelled it.
 *
 * Read from the taps themselves rather than from the derived reading, because
 * this runs while the muster is happening and the reading is rebuilt
 * afterwards.
 *
 * Both tap tables, not just the live one. They are two views of the same
 * booth: the live session hears a tap in about a second, the periodic pull
 * finds it within half a minute, and either may hold a tap the other missed —
 * a session that dropped for a minute, a machine nobody is listening to.
 *
 * Taking only the live events cost a spare his allocation. His first finger
 * went unheard, so his second finger at 17:28 became his "first", which is
 * three minutes past the 17:25 deadline: the ticket printed, as it must, but
 * with no unit on it. The arrival is a fact about the morning, not about which
 * of our two readers happened to catch it.
 */
export async function firstTapOf(
  nik: string,
  date: string,
  shift: ShiftKind
): Promise<string | null> {
  const [live, pulled] = await Promise.all([
    db
      .select({ at: schema.deviceLiveEvents.at })
      .from(schema.deviceLiveEvents)
      .where(
        and(
          eq(schema.deviceLiveEvents.nik, nik),
          sql`${schema.deviceLiveEvents.at}::date = ${date}::date`
        )
      ),
    db
      .select({ at: schema.deviceTaps.at })
      .from(schema.deviceTaps)
      .where(
        and(
          eq(schema.deviceTaps.nik, nik),
          sql`${schema.deviceTaps.at}::date = ${date}::date`
        )
      ),
  ]);

  /* Sorted here rather than in two queries: the union is what has to be
     ordered, and both halves are a handful of rows for one person on one day. */
  const mine = [...live, ...pulled]
    .map((r) => r.at)
    .filter((at) => inShift(at.slice(11, 19), shift))
    .sort();
  return mine[0] ?? null;
}

export type IssueResult =
  | {
      issued: false;
      reason: "unknown-person" | "no-deadline" | "held-back" | "duplicate";
    }
  | {
      issued: true;
      status: "printed" | "failed" | "dry";
      preview: string;
      attempts: number;
      error?: string;
    };

/** Injected so a test can issue a ticket without a printer on the network. */
export type IssueDeps = {
  print?: (
    target: { ip: string; port: number },
    bytes: Buffer
  ) => Promise<
    { sent: true; ms: number } | { sent: false; reason: string; ms: number }
  >;
  printingEnabled?: boolean;
  /** How long to keep trying. Production uses the minute the owner asked for. */
  retry?: { forMs: number; gapMs: number };
};

/**
 * Issue the ticket for one tap.
 *
 * Returns rather than throws, always: the caller is the live tap path.
 */
export async function issueTicket(
  tap: { ip: string; nik: string; at: string; date: string; shift: ShiftKind },
  deps: IssueDeps = {}
): Promise<IssueResult> {
  const [person] = await db
    .select({
      nik: schema.employees.nik,
      name: schema.employees.name,
      position: schema.positions.name,
      department: schema.departments.name,
    })
    .from(schema.employees)
    .leftJoin(
      schema.positions,
      eq(schema.positions.id, schema.employees.positionId)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .where(eq(schema.employees.nik, tap.nik))
    .limit(1);
  if (!person) return { issued: false, reason: "unknown-person" };

  const [deadline, uploadClose, secondFingerAt] = await Promise.all([
    fingerInDeadline(tap.shift),
    ftwDeadline(tap.shift),
    stageTimeOf("finger-second", tap.shift),
  ]);
  /* An unconfigured timeline refuses loudly rather than inventing a verdict —
     the same refusal the board makes, for the same reason. */
  if (!deadline || !uploadClose || !secondFingerAt)
    return { issued: false, reason: "no-deadline" };

  const [role, held, firstTap, ftwRow] = await Promise.all([
    roleOf(tap.nik),
    seatOf(tap.nik, tap.date, tap.shift),
    firstTapOf(tap.nik, tap.date, tap.shift),
    db
      .select()
      .from(schema.ftwReadings)
      .where(
        and(
          eq(schema.ftwReadings.nik, tap.nik),
          eq(schema.ftwReadings.date, tap.date)
        )
      )
      .limit(1)
      .then((rows) => rows[0] ?? null),
  ]);

  const firstAt = firstTap ?? tap.at;
  const readiness = judge({
    ftw: ftwRow
      ? {
          ftwDecision: ftwRow.ftwDecision,
          sleepCategory: ftwRow.sleepCategory,
          sentAt: ftwRow.sentAt,
        }
      : null,
    finger: { firstInAt: firstAt },
    requiresFtw: held?.requiresFtw ?? false,
    deadline,
    ftwDeadline: uploadClose,
  });

  const decision = ticketFor({
    role,
    readiness,
    seat: held?.seat ?? null,
    tappedAt: tap.at.slice(11, 19),
    firstTapAt: firstAt.slice(11, 19),
    secondFingerAt,
  });
  if (!decision.print) return { issued: false, reason: "held-back" };

  const [[machine], notices] = await Promise.all([
    db
      .select({
        printerId: schema.printers.id,
        printerName: schema.printers.name,
        printerIp: schema.printers.ip,
        printerPort: schema.printers.port,
        printerActive: schema.printers.active,
      })
      .from(schema.fingerprintMachines)
      .leftJoin(
        schema.printers,
        eq(schema.printers.id, schema.fingerprintMachines.printerId)
      )
      .where(eq(schema.fingerprintMachines.ip, tap.ip))
      .limit(1),
    /* The same rows the wall is showing this morning, capped for paper. */
    activeNotices(),
  ]);

  const fields: TicketFields = {
    nik: person.nik,
    name: person.name,
    position: person.position ?? "-",
    department: person.department ?? "-",
    role,
    /* savera's own category, not the verdict `judge` made of it: the slip
       states what the rule decided about him, and whether that was enough for
       a unit is said by the allocation lines above. */
    ftw: ftwRow ? (ftwRow.sleepCategory ?? "Belum mengisi FTW") : null,
    hazards: notices.hazards,
    safety: notices.safety,
    seat: decision.seat,
    printerName: machine?.printerName ?? "-",
    at: `${tap.date} ${decision.at}`,
  };
  const preview = ticketPreview(fields);
  const contentHash = Bun.hash(preview).toString(16);

  /* The claim. A second tap carrying the same slip loses here, which is the
     dedup rule: a repeat prints only when something on it changed. */
  const [claimed] = await db
    .insert(schema.tickets)
    .values({
      nik: person.nik,
      date: tap.date,
      shift: tap.shift,
      ip: tap.ip,
      printerId: machine?.printerId ?? null,
      status: "dry",
      contentHash,
      preview,
      fields,
    })
    .onConflictDoNothing()
    .returning({ id: schema.tickets.id });
  if (!claimed) return { issued: false, reason: "duplicate" };

  const printing = deps.printingEnabled ?? env.TICKET_PRINTING;
  const target =
    machine?.printerIp && machine.printerActive
      ? { ip: machine.printerIp, port: machine.printerPort ?? 9100 }
      : null;

  if (!printing || !target)
    return { issued: true, status: "dry", preview, attempts: 0 };

  const send = deps.print ?? ((t, bytes) => sendToPrinter(t.ip, t.port, bytes));
  const { outcome, attempts } = await printWithRetry(
    (bytes) => send(target, bytes),
    renderTicket(fields),
    deps.retry
  );

  await db
    .update(schema.tickets)
    .set({
      status: outcome.sent ? "printed" : "failed",
      attempts,
      printedAt: outcome.sent ? new Date() : null,
      lastError: outcome.sent ? null : outcome.reason,
    })
    .where(eq(schema.tickets.id, claimed.id));

  return outcome.sent
    ? { issued: true, status: "printed", preview, attempts }
    : {
        issued: true,
        status: "failed",
        preview,
        attempts,
        error: outcome.reason,
      };
}

/**
 * Print a stored ticket again.
 *
 * Renders the slip from the fields it was built with, not from the allocation
 * as it stands now: the paper somebody is handed after a jam should be the
 * paper they were owed, not a fresh answer to a question asked an hour ago.
 *
 * Refuses quietly rather than throwing — the caller is a button on a screen.
 */
export async function reprintTicket(
  id: string,
  deps: IssueDeps = {}
): Promise<
  | {
      reprinted: false;
      reason: "ticket_not_found" | "no_printer" | "printing_off";
    }
  | {
      reprinted: true;
      status: "printed" | "failed";
      attempts: number;
      error?: string;
    }
> {
  const [ticket] = await db
    .select({
      id: schema.tickets.id,
      fields: schema.tickets.fields,
      printerIp: schema.printers.ip,
      printerPort: schema.printers.port,
      printerActive: schema.printers.active,
    })
    .from(schema.tickets)
    .leftJoin(schema.printers, eq(schema.printers.id, schema.tickets.printerId))
    .where(eq(schema.tickets.id, id))
    .limit(1);
  if (!ticket) return { reprinted: false, reason: "ticket_not_found" };

  if (!(deps.printingEnabled ?? env.TICKET_PRINTING))
    return { reprinted: false, reason: "printing_off" };
  if (!ticket.printerIp || !ticket.printerActive)
    return { reprinted: false, reason: "no_printer" };

  const target = { ip: ticket.printerIp, port: ticket.printerPort ?? 9100 };
  const send = deps.print ?? ((t, bytes) => sendToPrinter(t.ip, t.port, bytes));
  const { outcome, attempts } = await printWithRetry(
    (bytes) => send(target, bytes),
    renderTicket(ticket.fields as TicketFields),
    deps.retry
  );

  await db
    .update(schema.tickets)
    .set({
      status: outcome.sent ? "printed" : "failed",
      attempts,
      printedAt: outcome.sent ? new Date() : null,
      lastError: outcome.sent ? null : outcome.reason,
    })
    .where(eq(schema.tickets.id, ticket.id));

  return outcome.sent
    ? { reprinted: true, status: "printed", attempts }
    : { reprinted: true, status: "failed", attempts, error: outcome.reason };
}
