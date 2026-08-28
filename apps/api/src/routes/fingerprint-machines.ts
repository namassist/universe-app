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

import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
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
} from "./schemas";

const toMachine = (row: FingerprintMachineRow) => ({
  id: row.id,
  name: row.name,
  ip: row.ip,
  active: row.active,
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

const duplicateIp = (ip: string) => ({
  code: "ip_taken",
  message: `IP ${ip} sudah dipakai mesin lain`,
});

/**
 * A single IPv4 host, each octet 0–255.
 *
 * Checked in the handler rather than declared as a TypeBox `pattern`, because
 * validation runs before this code can trim: an address pasted from a
 * spreadsheet arrives padded, and refusing that would be a rule about
 * whitespace rather than about addresses.
 */
const IPV4 =
  /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

const invalidIp = (ip: string) => ({
  code: "validation_failed",
  message: `"${ip}" bukan alamat IPv4 yang sah`,
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
          .values({ name, ip, active: body.active ?? true })
          .returning();
        return status(201, toMachine(row!));
      } catch (error) {
        // One address is one machine — see the table's unique constraint.
        if (isUniqueViolation(error)) return status(409, duplicateIp(ip));
        throw error;
      }
    },
    {
      auth: { menu: "mesin-fingerprint", mode: "manage" },
      body: t.Object({
        name: t.String({ minLength: 1 }),
        ip: t.String({ minLength: 1 }),
        active: t.Optional(t.Boolean()),
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
          })
          .where(eq(schema.fingerprintMachines.id, params.id))
          .returning();
        if (!row) return status(404, notFound);
        return toMachine(row);
      } catch (error) {
        if (isUniqueViolation(error)) return status(409, duplicateIp(ip!));
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
  );
