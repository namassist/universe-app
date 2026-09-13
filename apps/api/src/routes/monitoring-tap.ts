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
import {
  ActiveListenOneSchema,
  DeviceStatusListSchema,
  ErrorSchema,
  TapCompareSchema,
  LiveLogSchema,
  TapMonitorSchema,
  TicketListSchema,
} from "./schemas";
import {
  activeListens,
  listenableMachines,
  ListenRefused,
  startListening,
  stopListening,
} from "../live-listener";
import { reprintTicket } from "../ticket-issue";
import { env } from "../env";

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

/**
 * Every machine and how the collector last found it.
 *
 * One statement rather than a query per machine: thirty-three round trips to
 * answer "is anything down" is how a status screen becomes the reason the
 * database is busy during a muster.
 *
 * `note` carries the answer in the shape the collector wrote it — `"51200,
 * 95ms"` for a count, `"50591 tap, 13894ms"` for a pull, a bare reason like
 * `"ECONNREFUSED"` for a failure. The leading integer is the record count, and
 * a failure has none, which is why it is read with a regexp rather than split.
 */
async function deviceStatusOn(date: string) {
  const rows = await db.execute(sql`
    with req as (
      select ip, ok, note, at
      from ${schema.deviceRequests}
      where (at at time zone 'Asia/Makassar')::date = ${date}::date
    ),
    tally as (
      select ip,
             count(*) filter (where ok)::int as ok,
             count(*) filter (where not ok)::int as failed,
             max(at) filter (where ok) as last_ok,
             max(at) filter (where not ok) as last_fail
      from req group by ip
    ),
    counted as (
      select distinct on (ip) ip,
             nullif(substring(note from '^[0-9]+'), '')::int as records
      from req
      where ok and note ~ '^[0-9]+'
      order by ip, at desc
    ),
    failed as (
      select distinct on (ip) ip, note from req
      where not ok order by ip, at desc
    ),
    taps as (
      select ip, count(*)::int as taps from ${schema.deviceTaps}
      where at >= ${`${date} 00:00:00`} and at <= ${`${date} 23:59:59`}
      group by ip
    )
    select m.ip, m.name, m.operator_booth as "operatorBooth", m.active,
           c.records,
           to_char(t.last_ok at time zone 'Asia/Makassar', 'HH24:MI:SS') as "lastSeen",
           case when t.last_fail is not null
                 and (t.last_ok is null or t.last_fail > t.last_ok)
                then f.note end as "lastError",
           coalesce(t.ok, 0) as ok,
           coalesce(t.failed, 0) as failed,
           coalesce(p.taps, 0) as taps
    from ${schema.fingerprintMachines} m
    left join tally t on t.ip = m.ip
    left join counted c on c.ip = m.ip
    left join failed f on f.ip = m.ip
    left join taps p on p.ip = m.ip
    order by m.operator_booth desc, m.active desc, m.name
  `);
  return ((rows as unknown as { rows?: unknown[] }).rows ?? rows) as Array<{
    ip: string;
    name: string;
    operatorBooth: boolean;
    active: boolean;
    records: number | null;
    lastSeen: string | null;
    lastError: string | null;
    ok: number;
    failed: number;
    taps: number;
  }>;
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
    "/tickets",
    async ({ query }) => {
      const date = query.date ?? new Date().toISOString().slice(0, 10);
      const rows = await db
        .select({
          id: schema.tickets.id,
          nik: schema.tickets.nik,
          name: schema.employees.name,
          status: schema.tickets.status,
          preview: schema.tickets.preview,
          fields: schema.tickets.fields,
          attempts: schema.tickets.attempts,
          lastError: schema.tickets.lastError,
          issuedAt: schema.tickets.createdAt,
          machine: schema.fingerprintMachines.name,
          ip: schema.tickets.ip,
          printer: schema.printers.name,
        })
        .from(schema.tickets)
        .leftJoin(
          schema.employees,
          eq(schema.employees.nik, schema.tickets.nik)
        )
        .leftJoin(
          schema.fingerprintMachines,
          eq(schema.fingerprintMachines.ip, schema.tickets.ip)
        )
        .leftJoin(
          schema.printers,
          eq(schema.printers.id, schema.tickets.printerId)
        )
        .where(eq(schema.tickets.date, date))
        .orderBy(desc(schema.tickets.createdAt))
        .limit(500);

      const shaped = rows.map((r) => {
        const fields = r.fields as {
          at: string;
          seat: { unit: string } | null;
        };
        return {
          id: r.id,
          nik: r.nik,
          name: r.name ?? null,
          status: r.status,
          at: fields.at,
          unit: fields.seat?.unit ?? null,
          machine: r.machine ?? r.ip,
          printer: r.printer ?? null,
          attempts: r.attempts,
          lastError: r.lastError,
          preview: r.preview,
          issuedAt: r.issuedAt.toISOString(),
        };
      });

      return {
        date,
        printed: shaped.filter((r) => r.status === "printed").length,
        failed: shaped.filter((r) => r.status === "failed").length,
        dry: shaped.filter((r) => r.status === "dry").length,
        printing: env.TICKET_PRINTING,
        rows: shaped,
      };
    },
    {
      auth: { menu: "monitoring-tap", mode: "view" },
      query: t.Object({ date: t.Optional(t.String()) }),
      response: {
        200: TicketListSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Tickets issued on one date" },
    }
  )

  .post(
    "/tickets/:id/reprint",
    async ({ params, status }) => {
      const result = await reprintTicket(params.id);
      if (result.reprinted) return { status: result.status };
      /* Each refusal names itself: a ticket that is gone, a printer that is
         not there, and printing switched off are three different answers and
         three different things to do about them. */
      return status(result.reason === "ticket_not_found" ? 404 : 422, {
        code: result.reason,
        message:
          result.reason === "ticket_not_found"
            ? "Tiket tidak ditemukan"
            : result.reason === "no_printer"
              ? "Mesin ini tidak punya printer aktif"
              : "Pencetakan sedang dimatikan (TICKET_PRINTING)",
      });
    },
    {
      auth: { menu: "monitoring-tap", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({
          status: t.Union([t.Literal("printed"), t.Literal("failed")]),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Print a stored ticket again" },
    }
  )

  .get(
    "/live",
    async () => {
      /* Newest first and capped: this is a testing log, read while somebody
         taps, not a report. */
      const rows = await db
        .select({
          nik: schema.deviceLiveEvents.nik,
          name: schema.employees.name,
          at: schema.deviceLiveEvents.at,
          receivedAt: schema.deviceLiveEvents.receivedAt,
          machine: schema.fingerprintMachines.name,
          ip: schema.deviceLiveEvents.ip,
        })
        .from(schema.deviceLiveEvents)
        .leftJoin(
          schema.employees,
          eq(schema.employees.nik, schema.deviceLiveEvents.nik)
        )
        .leftJoin(
          schema.fingerprintMachines,
          eq(schema.fingerprintMachines.ip, schema.deviceLiveEvents.ip)
        )
        .orderBy(desc(schema.deviceLiveEvents.receivedAt))
        .limit(200);

      return {
        sessions: activeListens(),
        machines: await listenableMachines(),
        rows: rows.map((r) => ({
          nik: r.nik,
          name: r.name ?? null,
          at: r.at,
          receivedAt: r.receivedAt.toISOString(),
          machine: r.machine ?? r.ip,
        })),
      };
    },
    {
      auth: { menu: "monitoring-tap", mode: "view" },
      response: {
        200: LiveLogSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Taps as they arrive, and who is listening" },
    }
  )

  .post(
    "/live/start",
    async ({ body, principal, status }) => {
      try {
        return await startListening({
          machineId: body.machineId,
          source: "manual",
          startedBy: principal.kind === "user" ? principal.name : null,
        });
      } catch (error) {
        if (error instanceof ListenRefused)
          return status(
            error.code === "machine_not_found"
              ? 404
              : error.code === "already_listening"
                ? 409
                : 422,
            { code: error.code, message: error.message }
          );
        /* The machine refused the handshake, or is not answering at all. Said
           plainly rather than as a 500: nothing here is broken. */
        return status(502, {
          code: "listen_failed",
          message:
            error instanceof Error ? error.message : "Mesin tidak menjawab",
        });
      }
    },
    {
      auth: { menu: "monitoring-tap", mode: "manage" },
      body: t.Object({ machineId: t.String({ format: "uuid" }) }),
      response: {
        200: ActiveListenOneSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
        502: ErrorSchema,
      },
      detail: { summary: "Start listening to one machine" },
    }
  )

  .post(
    "/live/stop",
    async ({ body }) => ({ stopped: await stopListening(body.ip) }),
    {
      auth: { menu: "monitoring-tap", mode: "manage" },
      body: t.Object({ ip: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({ stopped: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Stop listening to one machine" },
    }
  )

  .get(
    "/devices",
    async ({ query }) => {
      const date = query.date ?? new Date().toISOString().slice(0, 10);
      const rows = await deviceStatusOn(date);

      /* Counted over the booths we actually collect from. A monitored machine
         that is off is a fact; an operator booth that is off is a queue of
         people whose taps are not being read. */
      const booths = rows.filter((r) => r.active && r.operatorBooth);
      const seen = rows
        .map((r) => r.lastSeen)
        .filter((t): t is string => t !== null)
        .sort();

      return {
        date,
        answering: booths.filter((r) => r.lastSeen !== null).length,
        silent: booths.filter((r) => r.lastSeen === null).length,
        lastContact: seen.at(-1) ?? null,
        rows,
      };
    },
    {
      auth: { menu: "monitoring-tap", mode: "view" },
      query: t.Object({ date: t.Optional(t.String()) }),
      response: {
        200: DeviceStatusListSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Every machine and how the collector last found it" },
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
