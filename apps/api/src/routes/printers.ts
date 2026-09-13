/**
 * The ticket printer registry.
 *
 * The sibling of the fingerprint machine registry, and owned here for the same
 * reason: ShiftCorner keeps its own pairing table, and a printer that is moved
 * or replaced should be an edit on this screen rather than a request to another
 * team.
 *
 * Pairing lives on the machine, not here — a booth has a printer, and that is
 * where somebody looks for it.
 */

import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, isUniqueViolation, schema, type PrinterRow } from "../db";
import { ErrorSchema, PrinterSchema } from "./schemas";
import { invalidIp, IPV4 } from "./ipv4";

const toPrinter = (row: PrinterRow) => ({
  id: row.id,
  name: row.name,
  ip: row.ip,
  port: row.port,
  active: row.active,
  createdAt: row.createdAt.toISOString(),
});

const notFound = {
  code: "printer_not_found",
  message: "Printer tidak ditemukan",
};

const duplicateIp = (ip: string) => ({
  code: "ip_taken",
  message: `IP ${ip} sudah dipakai printer lain`,
});

export const printerRoutes = new Elysia({
  prefix: "/printers",
  tags: ["printers"],
})
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await db
        .select()
        .from(schema.printers)
        .orderBy(asc(schema.printers.name));
      return rows.map(toPrinter);
    },
    {
      auth: { menu: "mesin-printer", mode: "view" },
      response: {
        200: t.Array(PrinterSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Every registered printer" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const name = body.name.trim();
      if (!name)
        return status(422, {
          code: "validation_failed",
          message: "Nama printer tidak boleh kosong",
        });
      const ip = body.ip.trim();
      if (!IPV4.test(ip)) return status(422, invalidIp(ip));

      try {
        const [row] = await db
          .insert(schema.printers)
          .values({
            name,
            ip,
            port: body.port ?? 9100,
            active: body.active ?? true,
          })
          .returning();
        return status(201, toPrinter(row!));
      } catch (error) {
        // One address is one printer — see the table's unique constraint.
        if (isUniqueViolation(error)) return status(409, duplicateIp(ip));
        throw error;
      }
    },
    {
      auth: { menu: "mesin-printer", mode: "manage" },
      body: t.Object({
        name: t.String({ minLength: 1 }),
        ip: t.String({ minLength: 1 }),
        port: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        201: PrinterSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Register a printer" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, status }) => {
      let name: string | undefined;
      if (body.name !== undefined) {
        name = body.name.trim();
        if (!name)
          return status(422, {
            code: "validation_failed",
            message: "Nama printer tidak boleh kosong",
          });
      }

      let ip: string | undefined;
      if (body.ip !== undefined) {
        ip = body.ip.trim();
        if (!IPV4.test(ip)) return status(422, invalidIp(ip));
      }

      try {
        const [row] = await db
          .update(schema.printers)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(ip !== undefined ? { ip } : {}),
            ...(body.port !== undefined ? { port: body.port } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
          })
          .where(eq(schema.printers.id, params.id))
          .returning();
        if (!row) return status(404, notFound);
        return toPrinter(row);
      } catch (error) {
        if (ip && isUniqueViolation(error)) return status(409, duplicateIp(ip));
        throw error;
      }
    },
    {
      auth: { menu: "mesin-printer", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        name: t.Optional(t.String()),
        ip: t.Optional(t.String()),
        port: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: PrinterSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Edit a printer" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      /* A booth paired with this printer keeps its row and loses the pairing —
         the foreign key is `on delete set null`. A printer that is merely
         unplugged is better deactivated than deleted. */
      const [row] = await db
        .delete(schema.printers)
        .where(eq(schema.printers.id, params.id))
        .returning({ id: schema.printers.id });
      if (!row) return status(404, notFound);
      return { ok: true as const };
    },
    {
      auth: { menu: "mesin-printer", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Literal(true) }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Remove a printer" },
    }
  );
