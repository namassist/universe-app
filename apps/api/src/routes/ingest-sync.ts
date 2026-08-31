/**
 * The readiness screens' routes: snapshot lists plus the manual sync escape
 * hatch beside the timeline.
 *
 * Lists read only the local snapshots — the whole point of ingesting is that
 * no request ever waits on savera or Nakula. The scheduled ingest windows
 * (`ftw-ingest`, `finger-ingest`) are the normal write path; the sync routes
 * exist for pulls outside the timeline and for recovery when an automated
 * window failed. One pass, not a window: the operator clicking the button
 * wants "now", and can click again.
 *
 * Mounted under the menus that own the data (`fit-to-work`, `attendance`)
 * so the permission that shows a screen is the permission that refreshes it.
 * Sync requires `manage`; reading only `view`.
 */

import { and, asc, desc, eq, gte, isNotNull, lte, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { ingestDates, syncFingerReadings, syncFtwReadings } from "../ingest";
import { fingerInDeadline, ftwDeadline } from "../readiness";
import {
  AttendanceListSchema,
  ErrorSchema,
  FtwListSchema,
  IngestSyncResultSchema,
  IngestSyncStatusSchema,
} from "./schemas";

const sourceUnreachable = {
  code: "source_unreachable",
  message: "Sumber data eksternal tidak dapat dihubungi",
};

/**
 * A range is two dates the right way round, spanning at most two months —
 * the screens page through days, not through years, and an unbounded range
 * would make one request return the whole history the snapshots accumulate.
 */
/** The export's columns, in the order a reader scans them. */
const FTW_EXPORT_COLUMNS = [
  "nik",
  "nama",
  "tanggal",
  "perusahaan",
  "departemen",
  "jabatan",
  "mess",
  "shift_upload",
  "jam_tidur",
  "menit_tidur",
  "kategori",
  "putusan_ftw",
  "waktu_kirim",
  "telat",
] as const;

type FtwExportRow = typeof schema.ftwReadings.$inferSelect & { late: boolean };

/**
 * Minutes as the screen shows them — "7j 20m" — beside the raw number.
 *
 * Both, because a spreadsheet is read by people *and* summed by them: the
 * label is what a supervisor recognises from the screen, and the integer is
 * the only one a formula can average.
 */
const sleepText = (minutes: number) =>
  `${Math.floor(minutes / 60)}j ${String(minutes % 60).padStart(2, "0")}m`;

async function ftwWorkbook(rows: FtwExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("ftw");
  ws.columns = FTW_EXPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width: key === "nama" || key === "departemen" ? 30 : 16,
  }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows)
    ws.addRow({
      nik: r.nik,
      nama: r.name,
      tanggal: r.date,
      perusahaan: r.company ?? "",
      departemen: r.department ?? "",
      jabatan: r.position ?? "",
      mess: r.mess ?? "",
      // Derived, not savera's own column — see the list route for why that
      // column cannot be trusted for this.
      shift_upload: r.sentAt
        ? r.sentAt.slice(11, 19) < "12:00:00"
          ? "Shift 1"
          : "Shift 2"
        : "",
      jam_tidur: sleepText(r.sleepMinutes),
      menit_tidur: r.sleepMinutes,
      kategori: r.sleepCategory ?? "",
      putusan_ftw: r.ftwDecision ?? "",
      waktu_kirim: r.sentAt ? r.sentAt.slice(11, 19) : "",
      telat: r.late ? "YA" : "",
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

const MAX_RANGE_DAYS = 62;

const invalidRange = {
  code: "invalid_range",
  message: `Rentang tanggal terbalik atau lebih dari ${MAX_RANGE_DAYS} hari`,
};

function rangeDays(from: string, to: string): number {
  const ms = Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`);
  return ms / (24 * 60 * 60 * 1000) + 1;
}

const RangeQuerySchema = t.Object({
  from: t.String({ format: "date" }),
  to: t.String({ format: "date" }),
});

async function lastSyncedAt(
  table: typeof schema.ftwReadings | typeof schema.fingerReadings
): Promise<string | null> {
  const [row] = await db
    .select({ at: sql<string | null>`max(${table.syncedAt})` })
    .from(table);
  return row?.at ? new Date(row.at).toISOString() : null;
}

export const fitToWorkSyncRoutes = new Elysia({
  prefix: "/fit-to-work",
  tags: ["fit-to-work"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query, status }) => {
      const { from, to } = query;
      const span = rangeDays(from, to);
      if (span < 1 || span > MAX_RANGE_DAYS) return status(422, invalidRange);

      const rows = await db
        .select()
        .from(schema.ftwReadings)
        .where(
          and(
            gte(schema.ftwReadings.date, from),
            lte(schema.ftwReadings.date, to)
          )
        )
        .orderBy(desc(schema.ftwReadings.date), asc(schema.ftwReadings.name));

      /*
       * Which gate a reading is judged against.
       *
       * The engine knows the shift because it is building one shift's board;
       * a list of readings has no such context, and savera's own `shift`
       * column is unusable — 1,030 rows say "Shift 1" and none says "Shift 2",
       * night uploads included. So the half of the day the upload falls in
       * stands in for it. This is presentation only: the board still judges
       * every reading against the exact gate of the shift it is building, and
       * the two never disagree for a person on the shift they uploaded for.
       */
      const [dayGate, nightGate] = await Promise.all([
        ftwDeadline("day"),
        ftwDeadline("night"),
      ]);
      const isLate = (sentAt: string | null): boolean => {
        if (!sentAt) return false;
        const at = sentAt.slice(11, 19);
        const gate = at < "12:00:00" ? dayGate : nightGate;
        return gate ? at >= gate : false;
      };

      return {
        rows: rows.map((r) => ({
          nik: r.nik,
          date: r.date,
          name: r.name,
          company: r.company,
          department: r.department,
          position: r.position,
          mess: r.mess,
          shift: r.shift,
          sleepMinutes: r.sleepMinutes,
          sleepCategory: r.sleepCategory,
          ftwDecision: r.ftwDecision,
          sentAt: r.sentAt,
          /** Uploaded after its shift's `ftw-deadline` — refused by the board. */
          late: isLate(r.sentAt),
        })),
        lastSyncedAt: await lastSyncedAt(schema.ftwReadings),
      };
    },
    {
      auth: { menu: "fit-to-work", mode: "view" },
      query: RangeQuerySchema,
      response: {
        200: FtwListSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "FTW verdict snapshots for a date range" },
    }
  )

  /**
   * The readings as a spreadsheet — what is on the screen, not what is in the
   * table.
   *
   * Every filter the list screen offers is repeated here as a query parameter,
   * because an export that quietly ignored them would hand someone the whole
   * range when they had narrowed to nine names. The cost is that two
   * predicates now describe one idea; they are kept adjacent and short for
   * exactly that reason, and `late` is computed in one place either way.
   */
  .get(
    "/export",
    async ({ query, status }) => {
      const { from, to } = query;
      const span = rangeDays(from, to);
      if (span < 1 || span > MAX_RANGE_DAYS) return status(422, invalidRange);

      const [dayGate, nightGate] = await Promise.all([
        ftwDeadline("day"),
        ftwDeadline("night"),
      ]);
      const isLate = (sentAt: string | null): boolean => {
        if (!sentAt) return false;
        const at = sentAt.slice(11, 19);
        const gate = at < "12:00:00" ? dayGate : nightGate;
        return gate ? at >= gate : false;
      };

      const rows = (
        await db
          .select()
          .from(schema.ftwReadings)
          .where(
            and(
              gte(schema.ftwReadings.date, from),
              lte(schema.ftwReadings.date, to)
            )
          )
          .orderBy(desc(schema.ftwReadings.date), asc(schema.ftwReadings.name))
      ).filter((r) => {
        const late = isLate(r.sentAt);
        if (query.company && r.company !== query.company) return false;
        if (query.department && r.department !== query.department) return false;
        if (query.shift) {
          const half = r.sentAt
            ? r.sentAt.slice(11, 19) < "12:00:00"
              ? "1"
              : "2"
            : "";
          if (half !== query.shift) return false;
        }
        if (query.category === "late" && !late) return false;
        if (query.category && query.category !== "late") {
          const cat = (r.sleepCategory ?? "").toLowerCase();
          const key = !r.sleepCategory
            ? "belum"
            : cat.startsWith("dapat")
              ? "fit"
              : cat.startsWith("tidak")
                ? "tidak"
                : "istirahat";
          if (key !== query.category) return false;
        }
        if (query.q) {
          const needle = query.q.toLowerCase();
          if (!r.name.toLowerCase().includes(needle) && !r.nik.includes(needle))
            return false;
        }
        return true;
      });

      const name = `ftw-${from}${from === to ? "" : `-sd-${to}`}.xlsx`;
      return new Response(
        new Uint8Array(
          await ftwWorkbook(rows.map((r) => ({ ...r, late: isLate(r.sentAt) })))
        ),
        {
          headers: {
            "content-type":
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            "content-disposition": `attachment; filename="${name}"`,
          },
        }
      );
    },
    {
      auth: { menu: "fit-to-work", mode: "view" },
      query: t.Object({
        from: t.String(),
        to: t.String(),
        company: t.Optional(t.String()),
        department: t.Optional(t.String()),
        /** "1" or "2" — the upload half of the day, as the screen derives it. */
        shift: t.Optional(t.String()),
        /** A sleep category key, or "late" for the administrative one. */
        category: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
      detail: {
        summary: "Export the filtered FTW readings as a spreadsheet",
        responses: {
          200: {
            description: "An .xlsx of exactly the rows the screen is showing",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "No grant on fit-to-work" },
          422: { description: "Range too wide or inverted" },
        },
      },
    }
  )

  .post(
    "/sync",
    async ({ status }) => {
      try {
        const result = await syncFtwReadings(ingestDates());
        return { ...result, syncedAt: new Date().toISOString() };
      } catch (error) {
        console.error("[ingest] manual ftw sync failed", error);
        return status(502, sourceUnreachable);
      }
    },
    {
      auth: { menu: "fit-to-work", mode: "manage" },
      response: {
        200: IngestSyncResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        502: ErrorSchema,
      },
      detail: { summary: "Pull FTW verdicts from savera now (one pass)" },
    }
  )

  .get(
    "/sync-status",
    async () => ({ lastSyncedAt: await lastSyncedAt(schema.ftwReadings) }),
    {
      auth: { menu: "fit-to-work", mode: "view" },
      response: {
        200: IngestSyncStatusSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "When FTW readings last synced" },
    }
  );

/**
 * One row per shift the morning is accountable for — not one row per tap.
 *
 * The population is the union of two facts, because either one alone lies
 * (owner, 2026-08-30):
 *
 *   - every IN tap in the range, so the screen never disagrees with the
 *     machines; and
 *   - every roster day that says `D` or `N`, so someone who was scheduled and
 *     *never tapped at all* has a row. Driven by taps alone they had none —
 *     they were invisible on the one screen whose job is to notice them.
 *
 * OUT taps are gone entirely. They were only ever here because a reading is
 * keyed by (nik, date), so a night shift's 06:00 checkout landed on the next
 * date as a row with no arrival — 461 of them, needing a `checkoutOf` lookup
 * to explain that they were not faults. With one row per rostered shift the
 * question does not arise: the night shift's IN is on its own roster date, and
 * the checkout is not shown at all.
 *
 * Left joins on the employee stay: a tap from a NIK with no employee record is
 * still a fact about the morning. Those rows carry a null `rosterCode`, which
 * is *not* the same claim as a roster that disagrees — see `AttendanceReading`.
 */
async function attendanceRows(from: string, to: string) {
  /*
   * Only the active document. The previous reading joined `roster_days`
   * without it, so a month that had been re-uploaded held two rows per
   * (employee, date) and the map kept whichever arrived last — the archive
   * silently overruling the roster in force.
   */
  const roster = await db
    .select({
      nik: schema.employees.nik,
      date: schema.rosterDays.date,
      code: schema.rosterDays.code,
      name: schema.employees.name,
      department: schema.departments.name,
      company: schema.companies.name,
    })
    .from(schema.rosterDays)
    .innerJoin(
      schema.rosterDocuments,
      and(
        eq(schema.rosterDocuments.id, schema.rosterDays.documentId),
        eq(schema.rosterDocuments.status, "aktif")
      )
    )
    .innerJoin(
      schema.employees,
      eq(schema.employees.id, schema.rosterDays.employeeId)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .leftJoin(
      schema.companies,
      eq(schema.companies.id, schema.employees.companyId)
    )
    .where(
      and(gte(schema.rosterDays.date, from), lte(schema.rosterDays.date, to))
    );

  const rosterAt = new Map(roster.map((r) => [`${r.nik} ${r.date}`, r]));

  const readings = await db
    .select({
      nik: schema.fingerReadings.nik,
      date: schema.fingerReadings.date,
      firstInAt: schema.fingerReadings.firstInAt,
      firstInIp: schema.fingerReadings.firstInIp,
      name: schema.employees.name,
      department: schema.departments.name,
      company: schema.companies.name,
    })
    .from(schema.fingerReadings)
    .leftJoin(
      schema.employees,
      eq(schema.employees.nik, schema.fingerReadings.nik)
    )
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .leftJoin(
      schema.companies,
      eq(schema.companies.id, schema.employees.companyId)
    )
    .where(
      and(
        gte(schema.fingerReadings.date, from),
        lte(schema.fingerReadings.date, to),
        /* An OUT with no IN is no longer a row of its own: it is the tail of
           a shift whose own row lives on the previous date. */
        isNotNull(schema.fingerReadings.firstInAt)
      )
    );

  /*
   * The gate each person is judged against is their *own* shift's, taken from
   * the roster code on the row — unlike the FTW screen, which has no roster to
   * consult and has to infer a half-day from the upload time. Exact here, so
   * no inference is warranted.
   *
   * `null` when the roster says nothing: we genuinely cannot tell whether
   * 05:20 was late for that person, and answering "not late" would be a claim
   * rather than an absence of one.
   */
  const [dayGate, nightGate] = await Promise.all([
    fingerInDeadline("day"),
    fingerInDeadline("night"),
  ]);

  /*
   * IP → machine name. The whole registry is 58 rows, so it loads once and is
   * looked up in memory rather than joined per reading twice over.
   *
   * An address with no registered machine keeps showing as the address: it is
   * still where the tap happened, and blanking it would hide a machine someone
   * forgot to register rather than reporting one.
   */
  const machineByIp = new Map(
    (
      await db
        .select({
          ip: schema.fingerprintMachines.ip,
          name: schema.fingerprintMachines.name,
        })
        .from(schema.fingerprintMachines)
    ).map((m) => [m.ip, m.name])
  );
  const machineAt = (ip: string | null) =>
    ip ? (machineByIp.get(ip) ?? ip) : null;

  const lateness = (code: string | null, at: string | null): boolean | null => {
    if (!at || !code) return null;
    const gate = code === "N" ? nightGate : code === "D" ? dayGate : null;
    // Strictly at-or-after: the deadline is when the gate closes, not the last
    // moment through it — the same comparison the pass rule makes.
    return gate ? at.slice(11, 19) >= gate : null;
  };

  type Row = {
    nik: string;
    date: string;
    name: string | null;
    department: string | null;
    company: string | null;
    rosterCode: string | null;
    firstInAt: string | null;
    firstInIp: string | null;
    firstInMachine: string | null;
    late: boolean | null;
  };

  const rows = new Map<string, Row>();

  /* Every tap first — the machines are the ground truth about arrival. */
  for (const r of readings) {
    const key = `${r.nik} ${r.date}`;
    const rosterCode = rosterAt.get(key)?.code ?? null;
    rows.set(key, {
      nik: r.nik,
      date: r.date,
      /* Fall back to the roster's copy of the name: the tap's join can miss
         only when the NIK is unknown here, and then the roster has none
         either — but keeping the order explicit costs nothing. */
      name: r.name ?? rosterAt.get(key)?.name ?? null,
      department: r.department ?? rosterAt.get(key)?.department ?? null,
      company: r.company ?? rosterAt.get(key)?.company ?? null,
      rosterCode,
      firstInAt: r.firstInAt,
      firstInIp: r.firstInIp,
      firstInMachine: machineAt(r.firstInIp),
      late: lateness(rosterCode, r.firstInAt),
    });
  }

  /* Then the scheduled shifts nobody tapped for. Only `D` and `N`: a rostered
     `OFF` with no tap is a person on leave behaving exactly as expected, and
     990 of those a day would bury the four that matter. */
  for (const r of roster) {
    if (r.code !== "D" && r.code !== "N") continue;
    const key = `${r.nik} ${r.date}`;
    if (rows.has(key)) continue;
    rows.set(key, {
      nik: r.nik,
      date: r.date,
      name: r.name,
      department: r.department,
      company: r.company,
      rosterCode: r.code,
      firstInAt: null,
      firstInIp: null,
      firstInMachine: null,
      late: null,
    });
  }

  return [...rows.values()].sort(
    (a, b) =>
      b.date.localeCompare(a.date) ||
      (a.firstInAt ?? "").localeCompare(b.firstInAt ?? "")
  );
}

/**
 * Tapped in on a day the roster does not schedule — the anomaly the screen
 * highlights (owner, 2026-08-30).
 *
 * A null `rosterCode` is deliberately *not* a mismatch. Two thirds of the taps
 * come from NIKs with no employee record at all, and never will have a roster;
 * flagging them would light up most of the screen every morning to report a
 * gap in our own records rather than anything about the person who tapped.
 */
const isMismatch = (r: {
  firstInAt: string | null;
  rosterCode: string | null;
}): boolean =>
  !!r.firstInAt &&
  r.rosterCode !== null &&
  r.rosterCode !== "D" &&
  r.rosterCode !== "N";

/** The attendance export's columns, in the order a reader scans them. */
const ATTENDANCE_EXPORT_COLUMNS = [
  "nik",
  "nama",
  "tanggal",
  "perusahaan",
  "departemen",
  "roster",
  "jam_masuk",
  "mesin_masuk",
  "ip_masuk",
  "telat",
  "keterangan",
] as const;

type AttendanceExportRow = Awaited<ReturnType<typeof attendanceRows>>[number];

async function attendanceWorkbook(
  rows: AttendanceExportRow[]
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("absensi");
  ws.columns = ATTENDANCE_EXPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width: key === "nama" || key === "departemen" ? 30 : 16,
  }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows)
    ws.addRow({
      nik: r.nik,
      nama: r.name ?? "",
      tanggal: r.date,
      perusahaan: r.company ?? "",
      departemen: r.department ?? "",
      roster: r.rosterCode ?? "",
      jam_masuk: r.firstInAt ? r.firstInAt.slice(11, 19) : "",
      mesin_masuk: r.firstInMachine ?? "",
      ip_masuk: r.firstInIp ?? "",
      // Blank rather than "TIDAK" when unknowable: an empty cell reads as "no
      // answer", which is the truth when the roster does not say.
      telat: r.late === null ? "" : r.late ? "YA" : "TIDAK",
      keterangan: !r.firstInAt
        ? `Dijadwalkan ${r.rosterCode} tapi tidak tap`
        : isMismatch(r)
          ? `Tap masuk tapi roster ${r.rosterCode}`
          : "",
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const attendanceSyncRoutes = new Elysia({
  prefix: "/attendance",
  tags: ["attendance"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query, status }) => {
      const { from, to } = query;
      const span = rangeDays(from, to);
      if (span < 1 || span > MAX_RANGE_DAYS) return status(422, invalidRange);

      return {
        rows: await attendanceRows(from, to),
        lastSyncedAt: await lastSyncedAt(schema.fingerReadings),
      };
    },
    {
      auth: { menu: "attendance", mode: "view" },
      query: RangeQuerySchema,
      response: {
        200: AttendanceListSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Fingerprint tap snapshots for a date range" },
    }
  )

  /** The taps as a spreadsheet — the screen's filters travel with it. */
  .get(
    "/export",
    async ({ query, status }) => {
      const { from, to } = query;
      const span = rangeDays(from, to);
      if (span < 1 || span > MAX_RANGE_DAYS) return status(422, invalidRange);

      const rows = (await attendanceRows(from, to)).filter((r) => {
        if (query.company && r.company !== query.company) return false;
        if (query.department && r.department !== query.department) return false;
        if (query.roster && r.rosterCode !== query.roster) return false;
        if (query.status === "late" && r.late !== true) return false;
        if (query.status === "no-tap" && r.firstInAt) return false;
        if (query.status === "mismatch" && !isMismatch(r)) return false;
        if (query.status === "on-time" && r.late !== false) return false;
        if (query.q) {
          const needle = query.q.toLowerCase();
          if (
            !(r.name ?? "").toLowerCase().includes(needle) &&
            !r.nik.includes(needle)
          )
            return false;
        }
        return true;
      });

      const name = `absensi-${from}${from === to ? "" : `-sd-${to}`}.xlsx`;
      return new Response(new Uint8Array(await attendanceWorkbook(rows)), {
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="${name}"`,
        },
      });
    },
    {
      auth: { menu: "attendance", mode: "view" },
      query: t.Object({
        from: t.String(),
        to: t.String(),
        company: t.Optional(t.String()),
        department: t.Optional(t.String()),
        roster: t.Optional(t.String()),
        /** "late" | "no-tap" | "mismatch" | "on-time" — the screen's. */
        status: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
      detail: {
        summary: "Export the filtered attendance taps as a spreadsheet",
        responses: {
          200: {
            description: "An .xlsx of exactly the rows the screen is showing",
            content: {
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
                { schema: { type: "string", format: "binary" } },
            },
          },
          401: { description: "No session" },
          403: { description: "No grant on attendance" },
          422: { description: "Range too wide or inverted" },
        },
      },
    }
  )

  .post(
    "/sync",
    async ({ status }) => {
      try {
        const result = await syncFingerReadings(ingestDates());
        return { ...result, syncedAt: new Date().toISOString() };
      } catch (error) {
        console.error("[ingest] manual finger sync failed", error);
        return status(502, sourceUnreachable);
      }
    },
    {
      auth: { menu: "attendance", mode: "manage" },
      response: {
        200: IngestSyncResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        502: ErrorSchema,
      },
      detail: { summary: "Pull fingerprint taps from Nakula now (one pass)" },
    }
  )

  .get(
    "/sync-status",
    async () => ({ lastSyncedAt: await lastSyncedAt(schema.fingerReadings) }),
    {
      auth: { menu: "attendance", mode: "view" },
      response: {
        200: IngestSyncStatusSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "When fingerprint readings last synced" },
    }
  );
