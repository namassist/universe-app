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

import { desc, eq } from "drizzle-orm";
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
      auth: { menu: "tiket", mode: "view" },
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
