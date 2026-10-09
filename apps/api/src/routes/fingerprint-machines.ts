/**
 * The fingerprint machine registry.
 *
 * These rows are the monitoring TV's subject: what the prober will reach for,
 * and what the wall shows a card for. Owned here rather than read from
 * Nakula's `tbl_m_absen_to_finger`, so adding a machine or retiring a dead one
 * is an edit on this screen and not a request to another team.
 *
 * Deactivating beats deleting for a machine that is merely unplugged: the row
 * keeps its identity (and, once the prober lands, its history) while dropping
 * out of probing and off the wall.
 */

import { asc, eq, inArray } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { checkTarget } from "../netcheck";
import { machineBoard } from "../prober";
import {
  db,
  isUniqueViolation,
  schema,
  type FingerprintMachineRow,
} from "../db";
import {
  ErrorSchema,
  FingerprintDisplaySchema,
  FingerprintMachineSchema,
  FingerprintNetcheckSchema,
} from "./schemas";
import { invalidIp, IPV4 } from "./ipv4";

const toMachine = (row: FingerprintMachineRow) => ({
  id: row.id,
  name: row.name,
  ip: row.ip,
  active: row.active,
  operatorBooth: row.operatorBooth,
  comKey: row.comKey,
  port: row.port,
  printerId: row.printerId,
  universeOnly: row.universeOnly,
  online: row.online,
  lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
  checkedAt: row.checkedAt?.toISOString() ?? null,
  statusSince: row.statusSince?.toISOString() ?? null,
  createdAt: row.createdAt.toISOString(),
});

const notFound = {
  code: "machine_not_found",
  message: "Mesin fingerprint tidak ditemukan",
};

/** One printer belongs to one booth — see the unique constraint on the column. */
const printerTaken = {
  code: "printer_taken",
  message: "Printer itu sudah dipasangkan ke mesin lain",
};

/* The two unique constraints this table can raise, told apart by name so a
   clash on the printer is not reported as a clash on the address. */
const IP_UNIQUE = "fingerprint_machines_ip_unique";
const PRINTER_UNIQUE = "fingerprint_machines_printer_id_unique";

/** A hand-ticked selection; the same ceiling as the unit registry's bulk delete. */
const SelectionSchema = t.Array(t.String({ format: "uuid" }), {
  minItems: 1,
  maxItems: 200,
});

const duplicateIp = (ip: string) => ({
  code: "ip_taken",
  message: `IP ${ip} sudah dipakai mesin lain`,
});

export const fingerprintMachineRoutes = new Elysia({
  prefix: "/fingerprint-machines",
  tags: ["fingerprint"],
})
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await db
        .select()
        .from(schema.fingerprintMachines)
        .orderBy(asc(schema.fingerprintMachines.name));
      return rows.map(toMachine);
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "view" },
      response: {
        200: t.Array(FingerprintMachineSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List the fingerprint machines" },
    }
  )

  /**
   * What the monitoring TV renders.
   *
   * Declared before any `/:id` route so the literal segment is never parsed as
   * an identifier, and readable by a paired device as well as by a user — the
   * same `allowDevice` shape the other kiosks use.
   *
   * It reads the rows the prober wrote and **opens no socket**: a request path
   * must never wait on hardware, exactly as it must never wait on Nakula.
   */
  .get(
    "/display",
    async ({ principal, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== "fingerprint")
        return status(403, {
          code: "forbidden",
          message: "Perangkat ini bukan untuk layar tersebut",
        });

      const rows = await machineBoard();
      const online = rows.filter((r) => r.online).length;
      return {
        servedAt: new Date().toISOString(),
        total: rows.length,
        online,
        offline: rows.length - online,
        machines: rows.map(toMachine),
      };
    },
    {
      auth: {
        menu: "monitoring-fingerprint",
        mode: "view",
        allowDevice: true,
      },
      response: {
        200: FingerprintDisplaySchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Machine status for the monitoring TV" },
    }
  )

  .post(
    "/",
    async ({ body, status }) => {
      const name = body.name.trim();
      if (!name)
        return status(422, {
          code: "validation_failed",
          message: "Nama mesin tidak boleh kosong",
        });
      const ip = body.ip.trim();
      if (!IPV4.test(ip)) return status(422, invalidIp(ip));

      try {
        const [row] = await db
          .insert(schema.fingerprintMachines)
          .values({
            name,
            ip,
            active: body.active ?? true,
            operatorBooth: body.operatorBooth ?? false,
            comKey: body.comKey ?? 0,
            port: body.port ?? 80,
            printerId: body.printerId ?? null,
            universeOnly: body.universeOnly ?? false,
          })
          .returning();
        return status(201, toMachine(row!));
      } catch (error) {
        // One address is one machine — see the table's unique constraint.
        if (isUniqueViolation(error, IP_UNIQUE))
          return status(409, duplicateIp(ip));
        if (isUniqueViolation(error, PRINTER_UNIQUE))
          return status(409, printerTaken);
        throw error;
      }
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "manage" },
      body: t.Object({
        name: t.String({ minLength: 1 }),
        ip: t.String({ minLength: 1 }),
        active: t.Optional(t.Boolean()),
        operatorBooth: t.Optional(t.Boolean()),
        comKey: t.Optional(t.Integer({ minimum: 0 })),
        port: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
        printerId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        universeOnly: t.Optional(t.Boolean()),
      }),
      response: {
        201: FingerprintMachineSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Register a fingerprint machine" },
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
            message: "Nama mesin tidak boleh kosong",
          });
      }

      let ip: string | undefined;
      if (body.ip !== undefined) {
        ip = body.ip.trim();
        if (!IPV4.test(ip)) return status(422, invalidIp(ip));
      }

      try {
        const [row] = await db
          .update(schema.fingerprintMachines)
          .set({
            ...(name !== undefined ? { name } : {}),
            ...(ip !== undefined ? { ip } : {}),
            ...(body.active !== undefined ? { active: body.active } : {}),
            ...(body.operatorBooth !== undefined
              ? { operatorBooth: body.operatorBooth }
              : {}),
            ...(body.comKey !== undefined ? { comKey: body.comKey } : {}),
            ...(body.port !== undefined ? { port: body.port } : {}),
            ...(body.printerId !== undefined
              ? { printerId: body.printerId }
              : {}),
            ...(body.universeOnly !== undefined
              ? { universeOnly: body.universeOnly }
              : {}),
          })
          .where(eq(schema.fingerprintMachines.id, params.id))
          .returning();
        if (!row) return status(404, notFound);
        return toMachine(row);
      } catch (error) {
        if (isUniqueViolation(error, IP_UNIQUE))
          return status(409, duplicateIp(ip!));
        if (isUniqueViolation(error, PRINTER_UNIQUE))
          return status(409, printerTaken);
        throw error;
      }
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        ip: t.Optional(t.String({ minLength: 1 })),
        active: t.Optional(t.Boolean()),
        operatorBooth: t.Optional(t.Boolean()),
        comKey: t.Optional(t.Integer({ minimum: 0 })),
        port: t.Optional(t.Integer({ minimum: 1, maximum: 65535 })),
        printerId: t.Optional(t.Nullable(t.String({ format: "uuid" }))),
        universeOnly: t.Optional(t.Boolean()),
      }),
      response: {
        200: FingerprintMachineSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Edit a fingerprint machine" },
    }
  )

  .delete(
    "/:id",
    async ({ params, status }) => {
      const [row] = await db
        .delete(schema.fingerprintMachines)
        .where(eq(schema.fingerprintMachines.id, params.id))
        .returning({ id: schema.fingerprintMachines.id });
      if (!row) return status(404, notFound);
      return { ok: true };
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Remove a fingerprint machine" },
    }
  )

  /**
   * Delete a hand-ticked selection in one statement.
   *
   * Unlike the unit registry's bulk delete this can be a set delete: nothing
   * holds a foreign key to a machine (taps carry the address, not the row), so
   * there is no partial refusal to report. `POST …/bulk-delete` rather than
   * `DELETE /fingerprint-machines` for the same reason as `units.ts`.
   */
  .post(
    "/bulk-delete",
    async ({ body }) => {
      const ids = [...new Set(body.ids)];
      const rows = await db
        .delete(schema.fingerprintMachines)
        .where(inArray(schema.fingerprintMachines.id, ids))
        .returning({ id: schema.fingerprintMachines.id });
      return { deleted: rows.length };
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "manage" },
      body: t.Object({ ids: SelectionSchema }),
      response: {
        200: t.Object({ deleted: t.Integer() }),
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Delete several fingerprint machines at once" },
    }
  )

  /**
   * Activate or deactivate a selection — the bulk form of the dialog's "Aktif"
   * toggle. A deactivated machine drops out of probing and off the wall.
   */
  .post(
    "/bulk-active",
    async ({ body }) => {
      const ids = [...new Set(body.ids)];
      const rows = await db
        .update(schema.fingerprintMachines)
        .set({ active: body.active })
        .where(inArray(schema.fingerprintMachines.id, ids))
        .returning({ id: schema.fingerprintMachines.id });
      return { updated: rows.length };
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "manage" },
      body: t.Object({ ids: SelectionSchema, active: t.Boolean() }),
      response: {
        200: t.Object({ updated: t.Integer() }),
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Activate or deactivate several machines at once" },
    }
  )

  /**
   * Ping and port-check one machine and its printer, now (`netcheck.ts`).
   *
   * One machine per request, so the dialog fills row by row and no request
   * waits on the whole site. This is the one route here that waits on
   * hardware, on purpose — and it writes nothing, so a viewer may run it.
   */
  .post(
    "/:id/netcheck",
    async ({ params, status }) => {
      const [row] = await db
        .select({
          ip: schema.fingerprintMachines.ip,
          port: schema.fingerprintMachines.port,
          printerIp: schema.printers.ip,
          printerPort: schema.printers.port,
        })
        .from(schema.fingerprintMachines)
        .leftJoin(
          schema.printers,
          eq(schema.printers.id, schema.fingerprintMachines.printerId)
        )
        .where(eq(schema.fingerprintMachines.id, params.id));
      if (!row) return status(404, notFound);

      const result = await checkTarget({
        ip: row.ip,
        port: row.port,
        printer:
          row.printerIp !== null && row.printerPort !== null
            ? { ip: row.printerIp, port: row.printerPort }
            : null,
      });
      return { id: params.id, ...result };
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "view" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: FingerprintNetcheckSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Ping and port-check one machine and its printer" },
    }
  );
