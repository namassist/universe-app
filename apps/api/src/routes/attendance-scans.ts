/**
 * The attendance TV's tickets: one card per scan, as scans reach us.
 *
 * The wall used to be a list of who had not arrived. It is now the person who
 * just put their finger on the glass — face, name, time, and the unit their
 * slip gave them — so the queue at the booth reads its own answer off the
 * screen. The screen plays the tickets; this only says which scans there are.
 *
 * **Anyone in our register, rostered or not** (owner, 2026-09-19). A person
 * the roster did not expect who taps in is still somebody at the gate.
 *
 * Its own file rather than more of `readiness-display.ts`: that one judges a
 * roster, this one reports taps, and neither reads what the other computes.
 */

import { and, eq, gte, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type { ShiftKind } from "@universe/contracts";

import {
  latestScans,
  mergeScans,
  SCANS_ON_WIRE,
  slipSeat,
  type MergedScan,
} from "../attendance-scans";
import { requireAuth } from "../auth/macro";
import { currentShift } from "../current-shift";
import { db, schema } from "../db";
import { ticketTapOf } from "../live-listener";
import { normalizeNik } from "../sources/nik";
import { shiftGates } from "../stage-time";
import { photoMimeType, photoPath } from "../storage";
import { AttendanceScansSchema, ErrorSchema } from "./schemas";

const wrongDevice = {
  code: "forbidden",
  message: "Perangkat ini bukan untuk layar tersebut",
};

const photoNotFound = {
  code: "photo_not_found",
  message: "Foto tidak ditemukan",
};

/**
 * The running shift, and the machine-clock moment it began.
 *
 * The same gate every other wall turns on, so the ticket screen never shows
 * last night's taps beside a fleet wall already on the morning. `null` with a
 * half-configured timeline, for `currentShift`'s reason.
 */
async function runningShift(): Promise<{
  date: string;
  shift: ShiftKind;
  since: string;
} | null> {
  const gates = await shiftGates();
  const now = currentShift(new Date(), gates);
  const gate = now ? gates[now.shift] : null;
  if (!now || !gate) return null;
  return { ...now, since: `${now.date} ${gate}` };
}

/** Every tap of this shift either source holds, as one list. */
async function scansSince(since: string): Promise<MergedScan[]> {
  const [live, pulled] = await Promise.all([
    db
      .select({
        ip: schema.deviceLiveEvents.ip,
        nik: schema.deviceLiveEvents.nik,
        at: schema.deviceLiveEvents.at,
        seenAt: schema.deviceLiveEvents.receivedAt,
      })
      .from(schema.deviceLiveEvents)
      .where(gte(schema.deviceLiveEvents.at, since)),
    db
      .select({
        ip: schema.deviceTaps.ip,
        nik: schema.deviceTaps.nik,
        at: schema.deviceTaps.at,
        seenAt: schema.deviceTaps.pulledAt,
        direction: schema.deviceTaps.direction,
      })
      .from(schema.deviceTaps)
      .where(gte(schema.deviceTaps.at, since)),
  ]);
  return mergeScans(live, pulled);
}

/**
 * The slip each scan's muster produced, if one did.
 *
 * Found by the rule the listener issues them by (`ticketTapOf`), not by the
 * wall's shift: a slip is filed under the tap's own half of the day, and
 * asking with any other date would miss the ones printed after midnight.
 * Newest wins when a repeat tap printed a changed slip.
 */
async function slipsOf(scans: MergedScan[]) {
  if (!scans.length) return () => null;
  const taps = scans.map((s) => ticketTapOf(s.ip, s));
  const rows = await db
    .select({
      nik: schema.tickets.nik,
      date: schema.tickets.date,
      shift: schema.tickets.shift,
      fields: schema.tickets.fields,
      createdAt: schema.tickets.createdAt,
    })
    .from(schema.tickets)
    .where(
      and(
        inArray(schema.tickets.nik, [...new Set(taps.map((t) => t.nik))]),
        inArray(schema.tickets.date, [...new Set(taps.map((t) => t.date))])
      )
    );
  const newest = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const key = `${row.nik}|${row.date}|${row.shift}`;
    const known = newest.get(key);
    if (!known || row.createdAt > known.createdAt) newest.set(key, row);
  }
  return (scan: MergedScan) => {
    const tap = ticketTapOf(scan.ip, scan);
    const row = newest.get(`${tap.nik}|${tap.date}|${tap.shift}`);
    return slipSeat(
      (row?.fields as Parameters<typeof slipSeat>[0] | undefined) ?? null
    );
  };
}

export const attendanceScanRoutes = new Elysia({
  prefix: "/attendance/display",
  tags: ["attendance"],
})
  .use(requireAuth)
  .get(
    "/scans",
    async ({ principal, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== "att")
        return status(403, wrongDevice);

      const running = await runningShift();
      if (!running)
        return {
          servedAt: new Date().toISOString(),
          date: null,
          shift: null,
          scans: [],
        };

      const all = await scansSince(running.since);
      const niks = [...new Set(all.map((s) => s.nik))];
      const people = niks.length
        ? await db
            .select({
              nik: schema.employees.nik,
              name: schema.employees.name,
              photoFile: schema.employees.photoFileName,
            })
            .from(schema.employees)
            .where(inArray(schema.employees.nik, niks))
        : [];
      const personOf = new Map(people.map((p) => [p.nik, p]));

      /* Somebody the register does not carry is dropped before the cut, so
         they cannot take a slot on the wire from somebody it does. */
      const known = all.filter((s) => personOf.has(s.nik));
      const wire = latestScans(known, SCANS_ON_WIRE);

      const wireNiks = [...new Set(wire.map((s) => s.nik))];
      const [slipOf, filings] = await Promise.all([
        slipsOf(wire),
        /* The shift's date, as the fleet wall reads FTW for the same board:
           one filing per person per day, whatever time it was scanned. */
        wireNiks.length
          ? db
              .select({
                nik: schema.ftwReadings.nik,
                category: schema.ftwReadings.sleepCategory,
              })
              .from(schema.ftwReadings)
              .where(
                and(
                  eq(schema.ftwReadings.date, running.date),
                  inArray(schema.ftwReadings.nik, wireNiks)
                )
              )
          : [],
      ]);
      const ftwOf = new Map(filings.map((f) => [f.nik, f.category]));

      return {
        servedAt: new Date().toISOString(),
        date: running.date,
        shift: running.shift,
        scans: wire.map((scan) => {
          const person = personOf.get(scan.nik)!;
          const seat = slipOf(scan);
          return {
            key: scan.key,
            nik: scan.nik,
            name: person.name,
            photoFile: person.photoFile,
            /* The slip prints IN for every muster tap; only a pulled tap
               can say otherwise. */
            status:
              scan.direction === "out" ? ("OUT" as const) : ("IN" as const),
            scannedAt: scan.at.slice(11, 19),
            shift: running.shift,
            ftw: ftwOf.get(scan.nik) ?? null,
            unit: seat?.unit ?? null,
            area: seat?.area ?? null,
            bus: seat?.bus ?? null,
          };
        }),
      };
    },
    {
      auth: { menu: "display-attendance", mode: "view", allowDevice: true },
      response: {
        200: AttendanceScansSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "The running shift's latest scans, for its TV" },
    }
  )

  /**
   * The face on a ticket.
   *
   * The same gate as the fleet wall's photo route, drawn around this wall: a
   * screen may fetch the photo of somebody who scanned during the running
   * shift and nobody else, and the answer for anybody else is the same 404 as
   * a person with no photo. Otherwise a paired TV would be a way to walk the
   * register one NIK at a time.
   */
  .get(
    "/photo/:nik",
    async ({ params, principal, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== "att")
        return status(403, wrongDevice);

      /* The scan check first, for every NIK asked about, and the register
         only after it. Checked the other way round, a NIK with a photo on file
         took three more queries to reach the same 404 than one without — a
         timing difference that would answer "does this person have a photo"
         for anybody who asked. */
      const nik = normalizeNik(params.nik);
      const running = await runningShift();
      if (!running) return status(404, photoNotFound);
      const [live, pulled] = await Promise.all([
        db
          .select({ id: schema.deviceLiveEvents.id })
          .from(schema.deviceLiveEvents)
          .where(
            and(
              eq(schema.deviceLiveEvents.nik, nik),
              gte(schema.deviceLiveEvents.at, running.since)
            )
          )
          .limit(1),
        db
          .select({ id: schema.deviceTaps.id })
          .from(schema.deviceTaps)
          .where(
            and(
              eq(schema.deviceTaps.nik, nik),
              gte(schema.deviceTaps.at, running.since)
            )
          )
          .limit(1),
      ]);
      if (!live.length && !pulled.length) return status(404, photoNotFound);

      const [person] = await db
        .select({ photoFileName: schema.employees.photoFileName })
        .from(schema.employees)
        .where(eq(schema.employees.nik, nik))
        .limit(1);
      if (!person?.photoFileName) return status(404, photoNotFound);

      const file = Bun.file(photoPath(person.photoFileName));
      // The row can outlive the file (design D8); a wall falls back from a 404.
      if (!(await file.exists())) return status(404, photoNotFound);
      return new Response(file, {
        headers: { "content-type": photoMimeType(person.photoFileName) },
      });
    },
    {
      auth: { menu: "display-attendance", mode: "view", allowDevice: true },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      // No 200 schema: the body is an image (see the fleet photo route).
      response: { 401: ErrorSchema, 403: ErrorSchema, 404: ErrorSchema },
      detail: { summary: "A scanned person's photo, for the attendance TV" },
    }
  );
