/**
 * The two readiness kiosks: who has arrived, and who has filed their FTW.
 *
 * Both answer one question about the shift that is running *now*, for the
 * people the roster scheduled onto it. The shift is chosen from the timeline's
 * own gates rather than passed in — a TV has nobody to pick a date for it —
 * and it is the same boundary the fleet wall turns on, so the three screens in
 * a room never disagree about which shift it is.
 *
 * **The list is the exception list, and the counts are the truth.** A shift
 * rosters several hundred people; scrolling all of them past a wall takes the
 * better part of an hour, by which time the person who wanted their own row
 * has walked away. So the rows are ordered by what a supervisor would walk
 * over for — nobody has tapped, then late, then the rest newest-first — and
 * cut at `WALL_ROWS`. The stat tiles above them are computed from the whole
 * roster, so the screen never understates the problem it is cutting.
 *
 * Neither endpoint fails on an empty answer. A wall that renders an error
 * renders nothing, and "no roster for this shift" is a reading of its own.
 */

import { and, eq, inArray } from "drizzle-orm";
import { Elysia } from "elysia";
import type { ShiftKind } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { currentShift } from "../current-shift";
import { db, schema } from "../db";
import { rosterDayInForce } from "../roster-in-force";
import {
  fingerInDeadline,
  ftwDeadline,
  judgeFinger,
  judgeFtw,
  shiftIn,
  type FingerRecord as FingerReading,
  type FingerVerdict,
  type FtwVerdict,
} from "../readiness";
import { shiftGates } from "../stage-time";
import {
  AttendanceDisplaySchema,
  ErrorSchema,
  FitWorkDisplaySchema,
} from "./schemas";

/**
 * How many rows a wall carries.
 *
 * The table loops at four seconds a row, so this is really a statement about
 * the loop: forty rows come back around every two and a half minutes, which is
 * about as long as anyone stands in front of a screen at a gate. Raising it
 * does not show more, it shows the same rows less often.
 */
const WALL_ROWS = 40;

const wrongDevice = {
  code: "forbidden",
  message: "Perangkat ini bukan untuk layar tersebut",
};

/** The roster code each shift is scheduled under. */
const CODE_OF_SHIFT = { day: "D", night: "N" } as const satisfies Record<
  ShiftKind,
  string
>;

type RosterPerson = {
  nik: string;
  name: string;
  position: string | null;
  department: string | null;
};

/** Only the columns the walls judge on — the rows carry more. */
type FingerRecord = FingerReading & { nik: string };
type FtwRecord = {
  nik: string;
  ftwDecision: string | null;
  sleepCategory: string | null;
  sleepMinutes: number;
  sentAt: string | null;
};

/**
 * Of these people, the ones who owe a fit-to-work filing this morning.
 *
 * Two conditions, both the owner's (2026-09-14). The position must be one that
 * is allocated a unit at all — a payroll officer on the roster is not somebody
 * the muster is waiting on. And the person must hold a licence for at least one
 * unit the master marks `ftw`.
 *
 * **The master register is the authority, not what is running today.** The flag
 * is read across every unit carrying that simper code, active or not: `active`
 * says whether a machine is in service this morning, `ftw` says whether its
 * kind demands a filing, and a dozer parked for repair has not stopped being a
 * dozer. A code with no unit at all stays silent, and that is right rather than
 * a gap — the fleet owns none of those machines, so nobody can be put on one.
 *
 * *Any* qualifying licence obliges, not all of them. Somebody licensed on both
 * an excavator and a dump truck can be given either, so he files. Production
 * holds no such person today — the register is clean — but the rule is written
 * for the day one appears rather than against today's data.
 */
export async function ftwObliged(niks: string[]): Promise<Set<string>> {
  if (!niks.length) return new Set();
  const rows = await db
    .selectDistinct({ nik: schema.employees.nik })
    .from(schema.employees)
    .innerJoin(
      schema.positions,
      and(
        eq(schema.positions.id, schema.employees.positionId),
        eq(schema.positions.fleetAllocation, true)
      )
    )
    .innerJoin(
      schema.employeeSkills,
      eq(schema.employeeSkills.employeeId, schema.employees.id)
    )
    .innerJoin(
      schema.units,
      and(
        eq(schema.units.simperCodeId, schema.employeeSkills.simperCodeId),
        eq(schema.units.ftw, true)
      )
    )
    .where(inArray(schema.employees.nik, niks));
  return new Set(rows.map((r) => r.nik));
}

/**
 * Everyone the active roster puts on this shift.
 *
 * Only the document in force — joining `roster_days` without that check makes a
 * re-uploaded month return two rows per person, and the archive silently
 * overrules the roster the site is working to. The same trap the Attendance
 * menu fell into once already.
 */
async function shiftRoster(
  date: string,
  shift: ShiftKind
): Promise<RosterPerson[]> {
  const rows = await db
    .select({
      nik: schema.employees.nik,
      name: schema.employees.name,
      position: schema.positions.name,
      department: schema.departments.name,
    })
    .from(schema.rosterDays)
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.rosterDays.employeeId)
    )
    .leftJoin(
      schema.positions,
      eq(schema.positions.id, schema.employees.positionId)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .where(
      and(
        eq(schema.rosterDays.date, date),
        eq(schema.rosterDays.code, CODE_OF_SHIFT[shift]),
        rosterDayInForce
      )
    );

  /* One row per person even if two documents somehow both claim active: the
     wall would otherwise count someone twice in its own headline. */
  return [...new Map(rows.map((r) => [r.nik, r])).values()];
}

/** Ordering by "who would a supervisor walk over for", worst first. */
const rank = <T extends string>(order: readonly T[], value: T) =>
  order.indexOf(value);

const byName = (a: RosterPerson, b: RosterPerson) =>
  a.name.localeCompare(b.name);

/* ------------------------------------------------------------- attendance */

const FINGER_ORDER = ["missing", "late", "pass"] as const;

/**
 * The attendance wall's rows and counts, from a roster and a day's taps.
 *
 * Pure, and separate from the handler, because everything worth being wrong
 * about is here — which tap counts as the arrival, what "late" means, what
 * order a supervisor wants, and where the list is cut — while the handler only
 * fetches. It also means the tests never have to arrange for the clock to say
 * a particular shift.
 */
export function attendanceBoard(
  roster: RosterPerson[],
  readings: FingerRecord[],
  shift: ShiftKind,
  deadline: string
) {
  const byNik = new Map(readings.map((r) => [r.nik, r]));
  const judged = roster.map((person) => {
    /* Which of the day's two IN taps is this shift's arrival is a question
       only the roster answers, and `shiftIn` is where it is answered. */
    const arrival = shiftIn(byNik.get(person.nik) ?? null, shift);
    return {
      ...person,
      verdict: judgeFinger({ finger: arrival, deadline }),
      tappedAt: arrival?.firstInAt ? arrival.firstInAt.slice(11, 19) : null,
    };
  });

  const count = (v: FingerVerdict) =>
    judged.filter((r) => r.verdict === v).length;

  const rows = [...judged]
    .sort(
      (a, b) =>
        rank(FINGER_ORDER, a.verdict) - rank(FINGER_ORDER, b.verdict) ||
        // Within a group: nobody-tapped alphabetically, the late in the order
        // they arrived, and the present newest first — so a tap made thirty
        // seconds ago is at the top of where the eye already is.
        (a.verdict === "missing"
          ? byName(a, b)
          : a.verdict === "late"
            ? (a.tappedAt ?? "").localeCompare(b.tappedAt ?? "")
            : (b.tappedAt ?? "").localeCompare(a.tappedAt ?? ""))
    )
    .slice(0, WALL_ROWS);

  return {
    total: judged.length,
    present: count("pass"),
    late: count("late"),
    absent: count("missing"),
    rows,
  };
}

/**
 * The attendance TV: the running shift's roster against the morning's taps.
 *
 * `missing` is first for the reason the Attendance menu sorts it first — it is
 * the only row here that can leave a unit without an operator at 05:30.
 */
export const attendanceDisplayRoutes = new Elysia({
  prefix: "/attendance",
  tags: ["attendance"],
})
  .use(requireAuth)
  .get(
    "/display",
    async ({ principal, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== "att")
        return status(403, wrongDevice);

      const blank = {
        servedAt: new Date().toISOString(),
        date: null as string | null,
        shift: null as ShiftKind | null,
        total: 0,
        present: 0,
        late: 0,
        absent: 0,
        rows: [],
      };

      const now = currentShift(new Date(), await shiftGates());
      if (!now) return blank;

      // No configured gate means there is no such thing as late, and calling
      // every tap punctual would be a claim rather than a reading.
      const deadline = await fingerInDeadline(now.shift);
      if (!deadline) return { ...blank, date: now.date, shift: now.shift };

      const roster = await shiftRoster(now.date, now.shift);
      const readings = roster.length
        ? await db
            .select()
            .from(schema.fingerReadings)
            .where(
              and(
                eq(schema.fingerReadings.date, now.date),
                inArray(
                  schema.fingerReadings.nik,
                  roster.map((p) => p.nik)
                )
              )
            )
        : [];

      return {
        servedAt: new Date().toISOString(),
        date: now.date,
        shift: now.shift,
        ...attendanceBoard(roster, readings, now.shift, deadline),
      };
    },
    {
      auth: { menu: "display-attendance", mode: "view", allowDevice: true },
      response: {
        200: AttendanceDisplaySchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "The running shift's attendance, for its TV" },
    }
  );

/* ------------------------------------------------------------- fit to work */

/**
 * The order a supervisor walks the wall in (owner, 2026-09-14).
 *
 * By what savera decided about the *person*, not by which of our verdicts
 * applies: nobody has filed, then nobody may work, then everybody who must
 * rest first, then the rest. The wall used to lead with our own bookkeeping —
 * `unreadable` and `late` above a man told not to work — which put the row
 * that needs a phone call to IT above the row that needs one to a supervisor.
 *
 * A filing whose category we cannot place reads as `rest`: it is not a refusal
 * and not a clearance, and the badge beside it says the words savera used.
 */
const FTW_ORDER = ["none", "forbidden", "rest", "fit"] as const;
type FtwGroup = (typeof FTW_ORDER)[number];

/**
 * Which of those four a row belongs to.
 *
 * `missing` is the verdict, not the category, because a person with no filing
 * at all and a person whose filing carries no category are different mornings
 * — the first has not been to the clinic.
 */
function ftwGroup(row: {
  verdict: FtwVerdict;
  sleepCategory: string | null;
}): FtwGroup {
  if (row.verdict === "missing" || !row.sleepCategory) return "none";
  if (/^dapat/i.test(row.sleepCategory)) return "fit";
  if (/^tidak/i.test(row.sleepCategory)) return "forbidden";
  return "rest";
}

/** The fit-to-work wall's rows and counts. Pure, for the reasons above. */
export function fitWorkBoard(
  roster: RosterPerson[],
  readings: FtwRecord[],
  ftwDeadline: string
) {
  const byNik = new Map(readings.map((r) => [r.nik, r]));
  const judged = roster.map((person) => {
    const reading = byNik.get(person.nik) ?? null;
    return {
      ...person,
      /* `requiresFtw` is true for everyone here. On the fleet board the
         question is conditional — some units do not ask for FTW — but this
         screen exists to report the filing itself, so somebody who has not
         filed is missing rather than exempt. */
      verdict: judgeFtw({ ftw: reading, requiresFtw: true, ftwDeadline }),
      sleepMinutes: reading?.sleepMinutes ?? null,
      sleepCategory: reading?.sleepCategory ?? null,
      sentAt: reading?.sentAt ? reading.sentAt.slice(11, 19) : null,
    };
  });

  const count = (...v: FtwVerdict[]) =>
    judged.filter((r) => v.includes(r.verdict)).length;

  const rows = [...judged]
    .sort(
      (a, b) =>
        rank(FTW_ORDER, ftwGroup(a)) - rank(FTW_ORDER, ftwGroup(b)) ||
        (a.verdict === "pass"
          ? (b.sentAt ?? "").localeCompare(a.sentAt ?? "")
          : byName(a, b))
    )
    .slice(0, WALL_ROWS);

  return {
    total: judged.length,
    filed: judged.length - count("missing"),
    passed: count("pass"),
    // Everything filed that the board will not accept — a refusal, a late
    // upload, or a verdict savera reworded. One number, because from a wall
    // they are the same instruction: this person needs seeing to.
    refused: count("fail", "late", "unreadable"),
    missing: count("missing"),
    rows,
  };
}

/**
 * The fit-to-work TV: the same roster against savera's verdicts.
 *
 * `requiresFtw` is true for everyone here. On the fleet board the question is
 * conditional — some units do not ask for FTW — but this screen exists to
 * report the filing itself, so a person who has not filed is `missing` rather
 * than exempt.
 */
export const fitWorkDisplayRoutes = new Elysia({
  prefix: "/fit-to-work",
  tags: ["fit-to-work"],
})
  .use(requireAuth)
  .get(
    "/display",
    async ({ principal, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== "fitwork")
        return status(403, wrongDevice);

      const blank = {
        servedAt: new Date().toISOString(),
        date: null as string | null,
        shift: null as ShiftKind | null,
        total: 0,
        filed: 0,
        passed: 0,
        refused: 0,
        missing: 0,
        rows: [],
      };

      const now = currentShift(new Date(), await shiftGates());
      if (!now) return blank;

      // Same refusal as the attendance gate: with no deadline configured there
      // is no "late", and every upload would silently read as punctual.
      const deadline = await ftwDeadline(now.shift);
      if (!deadline) return { ...blank, date: now.date, shift: now.shift };

      /*
       * The wall counts who *owes* a filing, not who is on the roster.
       *
       * An excavator operator is never asked for one, so counting him as
       * "belum lapor" put a red row on the glass that nobody could act on —
       * and, because missing sorts first, pushed the people who had actually
       * failed to file off the bottom of a forty-row screen.
       */
      const rostered = await shiftRoster(now.date, now.shift);
      const obliged = await ftwObliged(rostered.map((p) => p.nik));
      const roster = rostered.filter((p) => obliged.has(p.nik));

      const readings = roster.length
        ? await db
            .select()
            .from(schema.ftwReadings)
            .where(
              and(
                eq(schema.ftwReadings.date, now.date),
                inArray(
                  schema.ftwReadings.nik,
                  roster.map((p) => p.nik)
                )
              )
            )
        : [];

      return {
        servedAt: new Date().toISOString(),
        date: now.date,
        shift: now.shift,
        ...fitWorkBoard(roster, readings, deadline),
      };
    },
    {
      auth: { menu: "display-fitwork", mode: "view", allowDevice: true },
      response: {
        200: FitWorkDisplaySchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "The running shift's FTW filings, for its TV" },
    }
  );
