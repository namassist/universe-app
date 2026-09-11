/**
 * Every tap, as the machines recorded it — duplicates and all.
 *
 * The Attendance screen shows one row a person a day: the arrival the board
 * acts on. That is the answer, and answering is what it is for. This screen
 * shows the *working*: somebody who tapped twice, somebody who tapped at two
 * machines, somebody whose tap landed a minute after the deadline.
 *
 * The question it exists to settle is one a supervisor used to have to take to
 * another team — "did he tap at all, and where" — and could not settle here at
 * all, because until the taps were kept we held only the reduction.
 *
 * Read-only. There is nothing on this screen to change; the taps are what the
 * machines said, and the reading derived from them is rebuilt rather than
 * edited. Three days of them, which is what we keep — the machines hold months
 * and remain the archive.
 */

import { and, desc, eq, gte, lte, sql } from "drizzle-orm";
import ExcelJS from "exceljs";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { ErrorSchema, TapCompareSchema, TapMonitorSchema } from "./schemas";

/** A page of taps, newest first — the end a supervisor reads. */
const PAGE = 500;

/**
 * Taps for a date, named and placed.
 *
 * Joined to the register and the machine list rather than stored with names:
 * a tap is a fact about a moment, and a person renamed or a machine moved
 * afterwards must not rewrite what the machine said.
 */
async function tapsOn(date: string, q?: string) {
  const rows = await db
    .select({
      nik: schema.deviceTaps.nik,
      at: schema.deviceTaps.at,
      direction: schema.deviceTaps.direction,
      verified: schema.deviceTaps.verified,
      ip: schema.deviceTaps.ip,
      machine: schema.fingerprintMachines.name,
      name: schema.employees.name,
      department: schema.departments.name,
    })
    .from(schema.deviceTaps)
    .leftJoin(
      schema.fingerprintMachines,
      eq(schema.fingerprintMachines.ip, schema.deviceTaps.ip)
    )
    .leftJoin(schema.employees, eq(schema.employees.nik, schema.deviceTaps.nik))
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .where(
      and(
        gte(schema.deviceTaps.at, `${date} 00:00:00`),
        lte(schema.deviceTaps.at, `${date} 23:59:59`)
      )
    )
    .orderBy(desc(schema.deviceTaps.at))
    .limit(PAGE);

  const needle = q?.trim().toLowerCase();
  return rows
    .filter(
      (r) =>
        !needle ||
        r.nik.includes(needle) ||
        (r.name ?? "").toLowerCase().includes(needle) ||
        (r.machine ?? "").toLowerCase().includes(needle)
    )
    .map((r) => ({
      nik: r.nik,
      name: r.name,
      department: r.department,
      at: r.at,
      direction: r.direction,
      verified: r.verified,
      ip: r.ip,
      /* A machine that has since been removed from the registry still recorded
         this tap; its address is what we have left to call it. */
      machine: r.machine ?? r.ip,
    }));
}

type TapRow = Awaited<ReturnType<typeof tapsOn>>[number];

const EXPORT_COLUMNS = [
  "nik",
  "nama",
  "departemen",
  "waktu",
  "arah",
  "mesin",
  "ip",
  "verifikasi",
] as const;

async function tapWorkbook(rows: TapRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("tap");
  ws.columns = EXPORT_COLUMNS.map((key) => ({
    header: key,
    key,
    width: key === "nama" || key === "departemen" || key === "mesin" ? 30 : 16,
  }));
  ws.getRow(1).font = { bold: true };
  for (const r of rows)
    ws.addRow({
      nik: r.nik,
      nama: r.name ?? "",
      departemen: r.department ?? "",
      waktu: r.at,
      arah: r.direction === "in" ? "Masuk" : "Pulang",
      mesin: r.machine,
      ip: r.ip,
      verifikasi: r.verified,
    });
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/**
 * Where the two sources disagree, for one shift on one date.
 *
 * The point of the parallel run. Everything else about the device path can be
 * proven by tests; that it produces the *same answers as the system it
 * replaces* can only be shown by running both and looking.
 *
 * **Scoped to our register, and to the shift's own column.** Two things would
 * otherwise fill this screen with differences that are not differences:
 *
 * - Nakula's table is the whole site's tap log, not ShiftCorner's operator
 *   subset, so it carries about a thousand people a month that we deliberately
 *   never collect. Compared without scoping, the device source looks like it
 *   lost a thousand people on its first day.
 * - Collection runs inside the muster window and nowhere else, so after a
 *   night-shift run the morning column is empty by design. Comparing both IN
 *   columns would report every morning arrival as missing.
 *
 * So: only people the register carries, and only the column `shiftIn` would
 * read for the shift being checked.
 */
async function compareOn(date: string, shift: "day" | "night") {
  /* The column this shift is actually judged by — the same choice `shiftIn`
     makes, spelled out here because this comparison has to ask it of two
     tables at once. */
  const nakulaIn =
    shift === "day"
      ? schema.fingerReadings.firstInAt
      : schema.fingerReadings.firstInPmAt;
  const deviceIn =
    shift === "day"
      ? schema.derivedReadings.firstInAt
      : schema.derivedReadings.firstInPmAt;

  const rows = await db
    .select({
      nik: schema.employees.nik,
      name: schema.employees.name,
      nakula: nakulaIn,
      device: deviceIn,
    })
    .from(schema.employees)
    .leftJoin(
      schema.fingerReadings,
      and(
        eq(schema.fingerReadings.nik, schema.employees.nik),
        eq(schema.fingerReadings.date, date)
      )
    )
    .leftJoin(
      schema.derivedReadings,
      and(
        eq(schema.derivedReadings.nik, schema.employees.nik),
        eq(schema.derivedReadings.date, date)
      )
    )
    .where(eq(schema.employees.status, "aktif"));

  const differences: {
    nik: string;
    name: string;
    kind: "only-nakula" | "only-device" | "drift";
    nakula: string | null;
    device: string | null;
    seconds: number | null;
  }[] = [];
  let matched = 0;

  for (const row of rows) {
    if (!row.nakula && !row.device) continue;
    if (row.nakula && row.device) {
      if (row.nakula === row.device) {
        matched += 1;
        continue;
      }
      differences.push({
        nik: row.nik,
        name: row.name,
        kind: "drift",
        nakula: row.nakula,
        device: row.device,
        seconds: Math.round(
          Math.abs(
            new Date(row.nakula).getTime() - new Date(row.device).getTime()
          ) / 1000
        ),
      });
      continue;
    }
    differences.push({
      nik: row.nik,
      name: row.name,
      /* The first of these is the one that costs somebody a unit: the old
         system saw them arrive and the new one did not. */
      kind: row.nakula ? "only-nakula" : "only-device",
      nakula: row.nakula,
      device: row.device,
      seconds: null,
    });
  }

  const count = (kind: string) =>
    differences.filter((d) => d.kind === kind).length;

  return {
    date,
    shift,
    matched,
    onlyNakula: count("only-nakula"),
    onlyDevice: count("only-device"),
    drift: count("drift"),
    /* Worst first: a missing arrival before a few seconds of drift. */
    differences: differences.sort(
      (a, b) =>
        (a.kind === "only-nakula" ? 0 : a.kind === "only-device" ? 1 : 2) -
          (b.kind === "only-nakula" ? 0 : b.kind === "only-device" ? 1 : 2) ||
        (b.seconds ?? 0) - (a.seconds ?? 0)
    ),
  };
}

export const monitoringTapRoutes = new Elysia({
  prefix: "/monitoring-tap",
  tags: ["monitoring-tap"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query }) => {
      const date = query.date ?? new Date().toISOString().slice(0, 10);
      const rows = await tapsOn(date, query.q);

      /* Counted over the taps themselves rather than over the page, so the
         headline does not change when somebody searches. */
      const [totals] = await db
        .select({
          taps: sql<number>`count(*)::int`,
          people: sql<number>`count(distinct ${schema.deviceTaps.nik})::int`,
          machines: sql<number>`count(distinct ${schema.deviceTaps.ip})::int`,
        })
        .from(schema.deviceTaps)
        .where(
          and(
            gte(schema.deviceTaps.at, `${date} 00:00:00`),
            lte(schema.deviceTaps.at, `${date} 23:59:59`)
          )
        );

      return {
        date,
        taps: totals?.taps ?? 0,
        people: totals?.people ?? 0,
        machines: totals?.machines ?? 0,
        rows,
      };
    },
    {
      auth: { menu: "monitoring-tap", mode: "view" },
      query: t.Object({
        date: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
      response: {
        200: TapMonitorSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Every tap on one date, newest first" },
    }
  )

  .get(
    "/export",
    async ({ query }) => {
      const date = query.date ?? new Date().toISOString().slice(0, 10);
      const rows = await tapsOn(date, query.q);
      return new Response(new Uint8Array(await tapWorkbook(rows)), {
        headers: {
          "content-type":
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
          "content-disposition": `attachment; filename="tap-${date}.xlsx"`,
        },
      });
    },
    {
      auth: { menu: "monitoring-tap", mode: "view" },
      query: t.Object({
        date: t.Optional(t.String()),
        q: t.Optional(t.String()),
      }),
      detail: { summary: "The same taps, as a workbook" },
    }
  )

  .get(
    "/compare",
    async ({ query }) =>
      compareOn(
        query.date ?? new Date().toISOString().slice(0, 10),
        query.shift ?? "day"
      ),
    {
      auth: { menu: "monitoring-tap", mode: "view" },
      query: t.Object({
        date: t.Optional(t.String()),
        shift: t.Optional(t.Union([t.Literal("day"), t.Literal("night")])),
      }),
      response: {
        200: TapCompareSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Where the old source and the new one disagree" },
    }
  );
