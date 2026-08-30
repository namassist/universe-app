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

import { and, asc, desc, eq, gte, inArray, lte, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { ingestDates, syncFingerReadings, syncFtwReadings } from "../ingest";
import { ftwDeadline } from "../readiness";
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
 * The taps enriched from local records: who this NIK is (when we know them)
 * and what the roster says about their day. Left joins on purpose — a tap
 * from a NIK with no employee record is still a fact about the morning, and
 * hiding it would make the screen disagree with the machines.
 */
async function attendanceRows(from: string, to: string) {
  const readings = await db
    .select({
      nik: schema.fingerReadings.nik,
      date: schema.fingerReadings.date,
      firstInAt: schema.fingerReadings.firstInAt,
      firstInIp: schema.fingerReadings.firstInIp,
      firstOutAt: schema.fingerReadings.firstOutAt,
      firstOutIp: schema.fingerReadings.firstOutIp,
      employeeId: schema.employees.id,
      name: schema.employees.name,
      department: schema.departments.name,
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
    .where(
      and(
        gte(schema.fingerReadings.date, from),
        lte(schema.fingerReadings.date, to)
      )
    )
    .orderBy(
      desc(schema.fingerReadings.date),
      asc(schema.fingerReadings.firstInAt)
    );

  // One roster query for the whole page of days, matched per (employee, date).
  const employeeIds = [
    ...new Set(readings.flatMap((r) => (r.employeeId ? [r.employeeId] : []))),
  ];
  const codeByEmployeeDate = new Map<string, string>();
  if (employeeIds.length) {
    const days = await db
      .select({
        employeeId: schema.rosterDays.employeeId,
        date: schema.rosterDays.date,
        code: schema.rosterDays.code,
      })
      .from(schema.rosterDays)
      .where(
        and(
          inArray(schema.rosterDays.employeeId, employeeIds),
          gte(schema.rosterDays.date, from),
          lte(schema.rosterDays.date, to)
        )
      );
    for (const day of days)
      codeByEmployeeDate.set(`${day.employeeId} ${day.date}`, day.code);
  }

  return readings.map((r) => ({
    nik: r.nik,
    date: r.date,
    name: r.name,
    department: r.department,
    rosterCode: r.employeeId
      ? (codeByEmployeeDate.get(`${r.employeeId} ${r.date}`) ?? null)
      : null,
    firstInAt: r.firstInAt,
    firstInIp: r.firstInIp,
    firstOutAt: r.firstOutAt,
    firstOutIp: r.firstOutIp,
  }));
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
