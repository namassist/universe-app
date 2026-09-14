/**
 * Muster tickets — the slip a person walks away with.
 *
 * Its own screen rather than a tab under the tap monitor, because it answers
 * its own question. The tap monitor is read while asking about a *tap*: did he
 * tap at all, and where. This is read while asking about a *slip*: did it come
 * out of the printer, and if not, whose hand is empty.
 *
 * Read-only except for one act — printing a stored ticket again. The ticket
 * itself is never edited: it was rendered from what was true at the tap, and a
 * reprint sends those same bytes to the printer a second time.
 */

import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { ErrorSchema, TicketListSchema } from "./schemas";
import { reprintTicket } from "../ticket-issue";
import { env } from "../env";

export const ticketRoutes = new Elysia({
  prefix: "/tickets",
  tags: ["tickets"],
})
  .use(requireAuth)

  .get(
    "/",
    async ({ query }) => {
      const date = query.date ?? new Date().toISOString().slice(0, 10);

      /*
       * Filtered in the database, not in the browser.
       *
       * The counts under the table have to answer "how many failed in *my*
       * department" — the question somebody opens this screen with — and a
       * filter applied after the five hundred row cut would count a different
       * set than it shows.
       */
      const needle = query.q?.trim();
      const where = [
        eq(schema.tickets.date, date),
        ...(query.shift ? [eq(schema.tickets.shift, query.shift)] : []),
        ...(query.status ? [eq(schema.tickets.status, query.status)] : []),
        ...(query.department
          ? [eq(schema.departments.name, query.department)]
          : []),
        /* `role` lives in the stored fields rather than a column: it is part
           of the slip, and the slip is what a reprint reproduces. Tickets
           issued before the line existed carry none, and match nothing. */
        ...(query.role
          ? [sql`${schema.tickets.fields}->>'role' = ${query.role}`]
          : []),
        ...(needle
          ? [
              or(
                ilike(schema.tickets.nik, `%${needle}%`),
                ilike(schema.employees.name, `%${needle}%`)
              )!,
            ]
          : []),
      ];

      const rows = await db
        .select({
          id: schema.tickets.id,
          nik: schema.tickets.nik,
          name: schema.employees.name,
          department: schema.departments.name,
          shift: schema.tickets.shift,
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
          schema.departments,
          eq(schema.departments.id, schema.employees.departmentId)
        )
        .leftJoin(
          schema.fingerprintMachines,
          eq(schema.fingerprintMachines.ip, schema.tickets.ip)
        )
        .leftJoin(
          schema.printers,
          eq(schema.printers.id, schema.tickets.printerId)
        )
        .where(and(...where))
        .orderBy(desc(schema.tickets.createdAt))
        .limit(500);

      /* The picker's options come from the whole day, not from the filtered
         rows — otherwise choosing a department empties the list you would use
         to choose a different one. */
      const departments = await db
        .selectDistinct({ name: schema.departments.name })
        .from(schema.tickets)
        .innerJoin(
          schema.employees,
          eq(schema.employees.nik, schema.tickets.nik)
        )
        .innerJoin(
          schema.departments,
          eq(schema.departments.id, schema.employees.departmentId)
        )
        .where(eq(schema.tickets.date, date))
        .orderBy(schema.departments.name);

      const shaped = rows.map((r) => {
        const fields = r.fields as {
          at: string;
          seat: { unit: string } | null;
          role?: "standing" | "spare";
        };
        return {
          id: r.id,
          nik: r.nik,
          name: r.name ?? null,
          department: r.department ?? null,
          shift: r.shift,
          /* Null on a slip printed before the line existed, which the screen
             shows as a dash rather than guessing. */
          role: fields.role ?? null,
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
        departments: departments.map((d) => d.name),
        rows: shaped,
      };
    },
    {
      auth: { menu: "tiket", mode: "view" },
      /*
       * `t.Union([t.Literal(…)])` on every optional enum, never
       * `t.Optional(t.UnionEnum([…]))`.
       *
       * The latter injects the *first* member when the field is absent, which
       * is the footgun the repo's own AGENTS.md warns about. Here it silently
       * filtered an unfiltered request to `status=printed`, `role=standing`,
       * `shift=day` — a list that looked like a short morning rather than a
       * broken query.
       */
      query: t.Object({
        date: t.Optional(t.String()),
        /** NIK or name, matched loosely — it is typed at a counter. */
        q: t.Optional(t.String()),
        department: t.Optional(t.String()),
        role: t.Optional(t.Union([t.Literal("standing"), t.Literal("spare")])),
        shift: t.Optional(t.Union([t.Literal("day"), t.Literal("night")])),
        status: t.Optional(
          t.Union([t.Literal("printed"), t.Literal("failed"), t.Literal("dry")])
        ),
      }),
      response: {
        200: TicketListSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Tickets issued on one date" },
    }
  )

  .post(
    "/:id/reprint",
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
      auth: { menu: "tiket", mode: "manage" },
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
  );
