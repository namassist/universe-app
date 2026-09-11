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
import { ErrorSchema, TapMonitorSchema } from "./schemas";

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
  );
