/**
 * Telling one person their seat (docs/prd.md, Mobile app → Notifications on
 * the phone).
 *
 * Rows are written at the event and wait for their `available_at`:
 *
 * - **The board** (`announceBoard`, after `storeBoard`): a holder's seat is
 *   available at once; a spare's, and anybody else the board seated, at
 *   `finger-second`, when the slip would print. A push at 05:26 would name
 *   the unit two minutes before the paper does.
 * - **A hand placement** (`announcePlacement`): the person put there, at
 *   `finger-second` if that is still ahead. The person moved off is told the
 *   seat no longer holds, but only if they had been told it in the first
 *   place; a seat they were never shown is simply taken back.
 *
 * `deliverDue` pushes whatever has come due, once. It is called after each
 * of those and by the `finger-second` stage. With no push service configured
 * it does nothing and marks nothing, and the app's own list still shows every
 * row: a push is a nudge, the list is the record.
 *
 * Only for employees with an account. Nobody else could read them.
 */

import { and, eq, gt, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import type { PersonNotificationKind, ShiftKind } from "@universe/contracts";

import { db, schema } from "./db";
import { pushSender } from "./push/fcm";
import { stageTimeOf } from "./stage-time";

/** As `localDate` in `scheduler.ts`, which imports this module: restated
 *  rather than imported, so the two do not import each other. */
const localDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** As long as the shared notifications are kept. */
const KEEP_DAYS = 90;
/** A push about a muster this long ago is no longer worth a buzz. */
const PUSH_WINDOW_MS = 12 * 60 * 60 * 1000;
/** Pushes in flight at once. */
const SEND_CONCURRENCY = 10;
/** Rows claimed by one delivery: one shift's board, with room to spare. */
const MAX_BATCH = 2000;

export type PushMessage = {
  title: string;
  body: string;
  data: Record<string, string>;
};
export type PushOutcome = "sent" | "unregistered" | "failed";
/** Null when no push service is configured. */
export type PushSender = {
  send(token: string, message: PushMessage): Promise<PushOutcome>;
} | null;

/** The local instant a stage time stands for on a muster's date. */
const instant = (date: string, clock: string) => new Date(`${date}T${clock}`);
const later = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

/** Everybody on this board who has an account, with their seat. */
async function seatedWithAccounts(date: string, shift: ShiftKind) {
  return db
    .select({
      employeeId: schema.fleetActualSlots.employeeId,
      unit: schema.units.code,
      area: schema.fleetActualSlots.workArea,
      bus: schema.fleetActualSlots.transportCode,
      fleet: schema.fleetActualFleets.leaderCode,
      source: schema.fleetActualSlots.source,
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
    .innerJoin(schema.users, eq(schema.users.nik, schema.employees.nik))
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
        eq(schema.employees.status, "aktif"),
        eq(schema.users.active, true)
      )
    );
}

/**
 * One row per seated person with an account. `secondFingerAt` is the
 * shift's `finger-second` time; without one no slip is printed for a spare
 * (`issueTicket` refuses), so no spare is announced either. Returns how many
 * rows were new.
 *
 * Run again for a regenerated board, it reconciles rather than adds: what
 * each person was last told about each unit is compared with the new board.
 * A seat they were told about and no longer have is retracted with
 * `seat-removed`; one still waiting for the second finger is simply taken
 * back; one they already know is not announced twice (security and code
 * review, 2026-10-17).
 */
export async function announceBoard(
  date: string,
  shift: ShiftKind,
  now: Date,
  secondFingerAt: string | null
): Promise<number> {
  /* A board regenerated for a muster already over is not news: its rows
     would be available at once and buzz a phone about a shift long gone.
     Yesterday still counts, for the night shift filed under the date it
     began. */
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  if (date < localDate(yesterday)) return 0;

  const seated = (await seatedWithAccounts(date, shift)).filter(
    (s) => s.employeeId && (s.source === "plan" || secondFingerAt)
  );
  const seatKey = (employeeId: string, unit: string) => `${employeeId}|${unit}`;
  const seatedNow = new Set(seated.map((s) => seatKey(s.employeeId!, s.unit)));

  /* What each person was last told about each unit on this shift. */
  const told = await db
    .select({
      id: schema.personNotifications.id,
      employeeId: schema.personNotifications.employeeId,
      kind: schema.personNotifications.kind,
      unit: sql<string>`${schema.personNotifications.params}->>'unit'`,
      availableAt: schema.personNotifications.availableAt,
    })
    .from(schema.personNotifications)
    .where(
      and(
        eq(schema.personNotifications.date, date),
        eq(schema.personNotifications.shift, shift)
      )
    )
    .orderBy(schema.personNotifications.createdAt);
  const last = new Map<string, (typeof told)[number]>();
  for (const row of told) last.set(seatKey(row.employeeId, row.unit), row);

  const stamp = now.getTime();
  for (const [key, row] of last) {
    if (row.kind !== "seat-assigned" || seatedNow.has(key)) continue;
    if (row.availableAt.getTime() > now.getTime())
      await db
        .delete(schema.personNotifications)
        .where(eq(schema.personNotifications.id, row.id));
    else
      await db
        .insert(schema.personNotifications)
        .values({
          employeeId: row.employeeId,
          kind: "seat-removed",
          date,
          shift,
          params: { unit: row.unit },
          dedupeKey: `${row.employeeId}|${date}|${shift}|removed|${row.unit}|${stamp}`,
          availableAt: now,
        })
        .onConflictDoNothing({ target: schema.personNotifications.dedupeKey });
  }

  const rows = seated.flatMap((s) => {
    const employeeId = s.employeeId!;
    const before = last.get(seatKey(employeeId, s.unit));
    if (before?.kind === "seat-assigned") return [];
    const isHolder = s.source === "plan";
    return [
      {
        employeeId,
        kind: "seat-assigned" as const,
        date,
        shift,
        params: {
          unit: s.unit,
          area: s.area ?? null,
          bus: s.bus ?? null,
          fleet: s.fleet ?? null,
        },
        /* Plain the first time, so a hook run twice writes one row; stamped
           when the seat comes back after being taken away. */
        dedupeKey: `${employeeId}|${date}|${shift}|board|${s.unit}${before ? `|${stamp}` : ""}`,
        availableAt: isHolder
          ? now
          : later(now, instant(date, secondFingerAt!)),
      },
    ];
  });

  let written = 0;
  if (rows.length) {
    const inserted = await db
      .insert(schema.personNotifications)
      .values(rows)
      .onConflictDoNothing({ target: schema.personNotifications.dedupeKey })
      .returning({ id: schema.personNotifications.id });
    written = inserted.length;
  }

  /* Swept here, as the shared notifications are: two boards a day is the
     whole write rate, and a stage of its own would be more machinery. */
  await db
    .delete(schema.personNotifications)
    .where(
      lt(
        schema.personNotifications.createdAt,
        sql`now() - ${`${KEEP_DAYS} days`}::interval`
      )
    );
  return written;
}

/** The seat a board's slot gives, for a hand placement's notice. */
async function slotSeat(date: string, shift: ShiftKind, unitId: string) {
  const [seat] = await db
    .select({
      unit: schema.units.code,
      area: schema.fleetActualSlots.workArea,
      bus: schema.fleetActualSlots.transportCode,
      fleet: schema.fleetActualFleets.leaderCode,
    })
    .from(schema.fleetActualSlots)
    .innerJoin(
      schema.fleetActualDocuments,
      eq(schema.fleetActualDocuments.id, schema.fleetActualSlots.documentId)
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
        eq(schema.fleetActualSlots.unitId, unitId)
      )
    )
    .limit(1);
  return seat ?? null;
}

const hasAccount = async (employeeId: string) =>
  (
    await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .innerJoin(schema.employees, eq(schema.employees.nik, schema.users.nik))
      .where(
        and(eq(schema.employees.id, employeeId), eq(schema.users.active, true))
      )
      .limit(1)
  ).length > 0;

export async function announcePlacement(input: {
  date: string;
  shift: ShiftKind;
  unitId: string;
  /** Who was put on the unit, or null when it was cleared. */
  placed: string | null;
  /** Who was on it before, when that is somebody else. */
  displaced: string | null;
  now: Date;
  secondFingerAt: string | null;
}): Promise<void> {
  const { date, shift, now } = input;
  const seat = await slotSeat(date, shift, input.unitId);
  if (!seat) return;
  /* The event's own time in the key: placed, moved off and placed back is
     three things that happened, where the board announced twice is one. */
  const stamp = now.getTime();

  if (input.displaced && input.displaced !== input.placed) {
    const forThisSeat = and(
      eq(schema.personNotifications.employeeId, input.displaced),
      eq(schema.personNotifications.kind, "seat-assigned"),
      eq(schema.personNotifications.date, date),
      eq(schema.personNotifications.shift, shift),
      sql`${schema.personNotifications.params}->>'unit' = ${seat.unit}`
    );
    /* Never shown: take it back, and there is nothing to retract. */
    await db
      .delete(schema.personNotifications)
      .where(and(forThisSeat, gt(schema.personNotifications.availableAt, now)));
    const [shown] = await db
      .select({ id: schema.personNotifications.id })
      .from(schema.personNotifications)
      .where(and(forThisSeat, lte(schema.personNotifications.availableAt, now)))
      .limit(1);
    if (shown)
      await db
        .insert(schema.personNotifications)
        .values({
          employeeId: input.displaced,
          kind: "seat-removed",
          date,
          shift,
          params: { unit: seat.unit },
          dedupeKey: `${input.displaced}|${date}|${shift}|removed|${seat.unit}|${stamp}`,
          availableAt: now,
        })
        .onConflictDoNothing({ target: schema.personNotifications.dedupeKey });
  }

  if (input.placed && input.secondFingerAt && (await hasAccount(input.placed)))
    await db
      .insert(schema.personNotifications)
      .values({
        employeeId: input.placed,
        kind: "seat-assigned",
        date,
        shift,
        params: {
          unit: seat.unit,
          area: seat.area ?? null,
          bus: seat.bus ?? null,
          fleet: seat.fleet ?? null,
        },
        dedupeKey: `${input.placed}|${date}|${shift}|manual|${seat.unit}|${stamp}`,
        availableAt: later(now, instant(date, input.secondFingerAt)),
      })
      .onConflictDoNothing({ target: schema.personNotifications.dedupeKey });
}

const MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Mei",
  "Jun",
  "Jul",
  "Agu",
  "Sep",
  "Okt",
  "Nov",
  "Des",
];
const shiftWord = (shift: ShiftKind) => (shift === "day" ? "siang" : "malam");
const dayMonth = (date: string) =>
  `${Number(date.slice(8, 10))} ${MONTHS[Number(date.slice(5, 7)) - 1]}`;

/**
 * The words on the phone's lock screen. Composed here, at send time, because
 * an operating system's notification needs a finished sentence; the app's own
 * list words each row from its kind, as the web does.
 */
export function pushText(row: {
  kind: PersonNotificationKind;
  date: string;
  shift: ShiftKind;
  params: Record<string, unknown>;
}): { title: string; body: string } {
  const when = `${shiftWord(row.shift)} ${dayMonth(row.date)}`;
  const unit = String(row.params.unit ?? "");
  if (row.kind === "seat-removed")
    return {
      title: "Penempatan berubah",
      body: `Kamu tidak lagi di ${unit} untuk shift ${when}. Buka aplikasi untuk detail.`,
    };
  const parts = [`Shift ${when}`];
  if (row.params.area) parts.push(`Area ${String(row.params.area)}`);
  if (row.params.bus) parts.push(`Bus ${String(row.params.bus)}`);
  return { title: `Unit kamu: ${unit}`, body: parts.join(" · ") };
}

/**
 * Push every row that has come due and not been pushed, to the phones of
 * the person it is for. Never throws: it runs after a board or a placement,
 * and failing to buzz a phone must not be able to break either.
 *
 * Rows are claimed before anything is sent (`UPDATE … WHERE pushed_at IS NULL
 * RETURNING`), so the `finger-second` stage and a placement delivering at
 * the same moment send each row once. A row none of whose phones took it is
 * released again, to be tried on the next delivery inside the window: an FCM
 * outage at 05:28 must not lose the notice. Only an account that is active
 * and past its password change is told: a deactivated or reset account's
 * phone may be in somebody else's hand.
 */
export async function deliverDue(
  now: Date,
  sender: PushSender
): Promise<{ sent: number }> {
  if (!sender) return { sent: 0 };
  try {
    const reachable = and(
      eq(schema.users.active, true),
      eq(schema.users.mustChangePassword, false)
    );
    const due = db
      .select({ id: schema.personNotifications.id })
      .from(schema.personNotifications)
      .innerJoin(
        schema.employees,
        eq(schema.employees.id, schema.personNotifications.employeeId)
      )
      .innerJoin(schema.users, eq(schema.users.nik, schema.employees.nik))
      .innerJoin(
        schema.pushDevices,
        and(
          eq(schema.pushDevices.userId, schema.users.id),
          /* iOS goes through APNs, which waits for the Apple account. */
          eq(schema.pushDevices.platform, "android")
        )
      )
      .where(
        and(
          reachable,
          isNull(schema.personNotifications.pushedAt),
          lte(schema.personNotifications.availableAt, now),
          gte(
            schema.personNotifications.availableAt,
            new Date(now.getTime() - PUSH_WINDOW_MS)
          )
        )
      )
      .limit(MAX_BATCH);

    const claimed = await db
      .update(schema.personNotifications)
      .set({ pushedAt: now })
      .where(
        and(
          inArray(schema.personNotifications.id, due),
          isNull(schema.personNotifications.pushedAt)
        )
      )
      .returning({
        id: schema.personNotifications.id,
        employeeId: schema.personNotifications.employeeId,
        kind: schema.personNotifications.kind,
        date: schema.personNotifications.date,
        shift: schema.personNotifications.shift,
        params: schema.personNotifications.params,
      });
    if (!claimed.length) return { sent: 0 };

    const phones = await db
      .select({
        employeeId: schema.employees.id,
        token: schema.pushDevices.token,
      })
      .from(schema.pushDevices)
      .innerJoin(schema.users, eq(schema.users.id, schema.pushDevices.userId))
      .innerJoin(schema.employees, eq(schema.employees.nik, schema.users.nik))
      .where(
        and(
          reachable,
          eq(schema.pushDevices.platform, "android"),
          inArray(schema.employees.id, [
            ...new Set(claimed.map((c) => c.employeeId)),
          ])
        )
      );

    const sends = claimed.flatMap((row) =>
      phones
        .filter((p) => p.employeeId === row.employeeId)
        .map((p) => ({ row, token: p.token }))
    );
    let sent = 0;
    const delivered = new Set<string>();
    const dropped: string[] = [];
    for (let i = 0; i < sends.length; i += SEND_CONCURRENCY) {
      await Promise.all(
        sends.slice(i, i + SEND_CONCURRENCY).map(async ({ row, token }) => {
          const params = row.params as Record<string, unknown>;
          const outcome = await sender.send(token, {
            ...pushText({ ...row, params }),
            data: {
              kind: row.kind,
              date: row.date,
              shift: row.shift,
              unit: String(params.unit ?? ""),
            },
          });
          if (outcome === "sent") {
            sent++;
            delivered.add(row.id);
          }
          if (outcome === "unregistered") dropped.push(token);
        })
      );
    }

    if (dropped.length)
      await db
        .delete(schema.pushDevices)
        .where(inArray(schema.pushDevices.token, dropped));
    const undelivered = claimed
      .map((c) => c.id)
      .filter((id) => !delivered.has(id));
    if (undelivered.length)
      await db
        .update(schema.personNotifications)
        .set({ pushedAt: null })
        .where(inArray(schema.personNotifications.id, undelivered));
    return { sent };
  } catch (error) {
    console.error("[person-notify] delivering due pushes failed", error);
    return { sent: 0 };
  }
}

/** What the person's own list shows: rows that have come due, newest first. */
export async function myNotifications(nik: string, now: Date, limit = 50) {
  const visible = and(
    eq(schema.employees.nik, nik),
    lte(schema.personNotifications.availableAt, now)
  );
  const [items, counted] = await Promise.all([
    db
      .select({
        id: schema.personNotifications.id,
        kind: schema.personNotifications.kind,
        date: schema.personNotifications.date,
        shift: schema.personNotifications.shift,
        params: schema.personNotifications.params,
        availableAt: schema.personNotifications.availableAt,
        readAt: schema.personNotifications.readAt,
      })
      .from(schema.personNotifications)
      .innerJoin(
        schema.employees,
        eq(schema.employees.id, schema.personNotifications.employeeId)
      )
      .where(visible)
      .orderBy(sql`${schema.personNotifications.availableAt} desc`)
      .limit(limit),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(schema.personNotifications)
      .innerJoin(
        schema.employees,
        eq(schema.employees.id, schema.personNotifications.employeeId)
      )
      .where(and(visible, isNull(schema.personNotifications.readAt))),
  ]);
  return { items, unread: counted[0]?.n ?? 0 };
}

/*
 * The three call sites, as one line each: the board's stage and the Actual
 * tab after a board is stored, the manual placement after a slot changes,
 * and the `finger-second` stage. Each reads the stage time and the sender
 * itself, and none of them throws: each runs after work that has already
 * succeeded, and telling a phone about it must not be able to undo it.
 */

export async function announceBoardNow(
  date: string,
  shift: ShiftKind
): Promise<void> {
  try {
    const now = new Date();
    await announceBoard(
      date,
      shift,
      now,
      await stageTimeOf("finger-second", shift)
    );
    void deliverDue(now, await pushSender());
  } catch (error) {
    console.error(
      `[person-notify] announcing the ${shift} board failed`,
      error
    );
  }
}

export async function announcePlacementNow(
  input: Omit<Parameters<typeof announcePlacement>[0], "now" | "secondFingerAt">
): Promise<void> {
  try {
    const now = new Date();
    await announcePlacement({
      ...input,
      now,
      secondFingerAt: await stageTimeOf("finger-second", input.shift),
    });
    void deliverDue(now, await pushSender());
  } catch (error) {
    console.error("[person-notify] announcing a placement failed", error);
  }
}

/** For the `finger-second` stage: whatever came due at the second finger. */
export async function releaseDue(): Promise<number> {
  return (await deliverDue(new Date(), await pushSender())).sent;
}
