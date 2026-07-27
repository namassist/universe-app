import { asc, eq } from "drizzle-orm";
import { Elysia, t } from "elysia";
import type {
  AccessMode,
  DeviceKind,
  EffectivePermissions,
  MenuSlug,
  RunTextColor,
} from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { invalidateDevice } from "../auth/principal";
import {
  cookieAttributes,
  createSession,
  DEVICE_COOKIE,
} from "../auth/session";
import { db, isUniqueViolation, schema, type DeviceRow } from "../db";
import { env } from "../env";
import { redis } from "../redis";
import {
  DeviceKindSchema,
  DeviceRunTextSchema,
  DeviceSchema,
  DisplayContentSchema,
  ErrorSchema,
  OptionalDeviceKindSchema,
} from "./schemas";

/**
 * Long enough to walk to the TV, short enough that a link left in a chat
 * thread is dead by the time anyone else reads it.
 */
const PAIRING_TTL_SECONDS = 15 * 60;

/** A device seen within this window counts as online. */
const ONLINE_WINDOW_SECONDS = 3 * 60;

const pairingKey = (token: string) => `pairing:${token}`;

/**
 * Which menu governs a device kind. A caller must hold the grant on the menu
 * the *device* belongs to, not merely on one display menu — otherwise a role
 * scoped to the fleet board could revoke an attendance TV.
 */
const MENU_OF_KIND: Record<DeviceKind, MenuSlug> = {
  att: "display-attendance",
  fleet: "display-fleet",
  fitwork: "display-fitwork",
  fingerprint: "monitoring-fingerprint",
};

/** Any display menu opens the registry; the handler narrows by kind. */
const DISPLAY_MENUS: MenuSlug[] = [
  "display-attendance",
  "display-fleet",
  "display-fitwork",
  "monitoring-fingerprint",
];

function mayTouch(
  permissions: EffectivePermissions,
  kind: DeviceKind,
  mode: AccessMode
): boolean {
  const held = permissions[MENU_OF_KIND[kind]];
  if (held === undefined) return false;
  return mode === "view" ? true : held === "manage";
}

/** 404 for an unknown device, 403 for one whose display menu the caller lacks. */
async function refuseUnlessOwned(
  id: string,
  permissions: EffectivePermissions
): Promise<{
  status: 403 | 404;
  body: { code: string; message: string };
} | null> {
  const [row] = await db
    .select({ kind: schema.devices.kind })
    .from(schema.devices)
    .where(eq(schema.devices.id, id))
    .limit(1);
  if (!row)
    return {
      status: 404,
      body: { code: "device_not_found", message: "Perangkat tidak ditemukan" },
    };
  if (!mayTouch(permissions, row.kind, "manage"))
    return {
      status: 403,
      body: {
        code: "forbidden",
        message: "Tidak punya akses ke layar tersebut",
      },
    };
  return null;
}

const DISPLAY_ROUTE_OF_KIND: Record<DeviceKind, string> = {
  att: "/display/attendance",
  fleet: "/display/fleet",
  fitwork: "/display/fitwork",
  fingerprint: "/display/fingerprint",
};

function lastSeenLabel(at: Date | null): string {
  if (!at) return "belum pernah";
  const seconds = Math.max(0, Math.floor((Date.now() - at.getTime()) / 1000));
  if (seconds < 60) return "baru saja";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m lalu`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}j lalu`;
  return `${Math.floor(hours / 24)}h lalu`;
}

/**
 * Online is derived from the heartbeat, never assumed: an anonymous URL cannot
 * produce it, which is the reason a TV has to identify itself at all.
 */
function toDevice(row: DeviceRow) {
  const online =
    row.active &&
    row.lastSeenAt !== null &&
    Date.now() - row.lastSeenAt.getTime() < ONLINE_WINDOW_SECONDS * 1000;
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    active: row.active,
    online,
    lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
    lastSeenLabel: lastSeenLabel(row.lastSeenAt),
    createdAt: row.createdAt.toISOString(),
  };
}

export const devicesRoutes = new Elysia({
  prefix: "/devices",
  tags: ["devices"],
})
  .use(requireAuth)

  /**
   * Pairing consumption is deliberately unauthenticated — the token *is* the
   * credential, and it is single-use and expiring. Declared before /:id so the
   * token is never parsed as a device id.
   */
  .get(
    "/pair/:token",
    async ({ params, cookie, redirect, status }) => {
      // GETDEL: consumed exactly once, so a replayed link finds nothing.
      const deviceId = await redis.getdel(pairingKey(params.token));
      if (!deviceId)
        return status(401, {
          code: "pairing_invalid",
          message: "Link pairing sudah dipakai atau kedaluwarsa",
        });

      const [device] = await db
        .select()
        .from(schema.devices)
        .where(eq(schema.devices.id, deviceId))
        .limit(1);
      if (!device || !device.active)
        return status(401, {
          code: "pairing_invalid",
          message: "Perangkat tidak aktif",
        });

      const session = await createSession("device", device.id, "cookie");
      cookie[DEVICE_COOKIE]!.set({
        value: session.id,
        ...cookieAttributes(session.maxAge),
      });
      // The kiosk page is served by the web app, not by this API. The cookie
      // is still set on the API's origin, which is where the TV's data
      // requests go — under a same-origin deployment the two coincide.
      const web = env.CORS_ORIGINS[0] ?? "";
      return redirect(`${web}${DISPLAY_ROUTE_OF_KIND[device.kind]}`, 302);
    },
    {
      params: t.Object({ token: t.String({ minLength: 1 }) }),
      response: { 401: ErrorSchema },
      detail: { summary: "Consume a pairing link and issue a device session" },
    }
  )

  .get(
    "/",
    async ({ query, permissions }) => {
      const rows = query.kind
        ? await db
            .select()
            .from(schema.devices)
            .where(eq(schema.devices.kind, query.kind))
        : await db.select().from(schema.devices);
      // A caller sees the kinds its own display grants cover, and no others.
      return rows
        .filter((r) => mayTouch(permissions, r.kind, "view"))
        .map(toDevice);
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "view" },
      query: t.Object({ kind: OptionalDeviceKindSchema }),
      response: {
        200: t.Array(DeviceSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List display devices with their online state" },
    }
  )

  .post(
    "/",
    async ({ body, permissions, status }) => {
      if (!mayTouch(permissions, body.kind, "manage"))
        return status(403, {
          code: "forbidden",
          message: "Tidak punya akses ke layar tersebut",
        });
      try {
        const [row] = await db
          .insert(schema.devices)
          .values({
            id: body.id.trim(),
            name: body.name.trim(),
            kind: body.kind,
            // Registered inactive-until-paired would strand a TV nobody can
            // pair, so it is active and revocable instead — the pairing link is
            // the gate, and deactivation ends the session on the next request.
            active: body.active ?? true,
          })
          .returning();
        return status(201, toDevice(row!));
      } catch (error) {
        if (isUniqueViolation(error))
          return status(409, {
            code: "device_exists",
            message: `Perangkat ${body.id} sudah terdaftar`,
          });
        throw error;
      }
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "manage" },
      body: t.Object({
        id: t.String({ minLength: 1 }),
        name: t.String({ minLength: 1 }),
        kind: DeviceKindSchema,
        active: t.Optional(t.Boolean()),
      }),
      response: {
        201: DeviceSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Register a display device" },
    }
  )

  .patch(
    "/:id",
    async ({ params, body, permissions, status }) => {
      const denied = await refuseUnlessOwned(params.id, permissions);
      if (denied) return status(denied.status, denied.body);
      const [row] = await db
        .update(schema.devices)
        .set({
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
        })
        .where(eq(schema.devices.id, params.id))
        .returning();
      if (!row)
        return status(404, {
          code: "device_not_found",
          message: "Perangkat tidak ditemukan",
        });
      // Revocation is one toggle: the cached principal drops and the next
      // request from the TV is refused.
      await invalidateDevice(params.id);
      return toDevice(row);
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "manage" },
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      body: t.Object({
        name: t.Optional(t.String({ minLength: 1 })),
        active: t.Optional(t.Boolean()),
      }),
      response: {
        200: DeviceSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Rename or activate/deactivate a device" },
    }
  )

  .delete(
    "/:id",
    async ({ params, permissions, status }) => {
      const denied = await refuseUnlessOwned(params.id, permissions);
      if (denied) return status(denied.status, denied.body);
      const [row] = await db
        .delete(schema.devices)
        .where(eq(schema.devices.id, params.id))
        .returning({ id: schema.devices.id });
      if (!row)
        return status(404, {
          code: "device_not_found",
          message: "Perangkat tidak ditemukan",
        });
      await invalidateDevice(params.id);
      return { ok: true };
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "manage" },
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Remove a display device" },
    }
  )

  .post(
    "/:id/pairing",
    async ({ params, permissions, request, status }) => {
      const [row] = await db
        .select()
        .from(schema.devices)
        .where(eq(schema.devices.id, params.id))
        .limit(1);
      if (!row)
        return status(404, {
          code: "device_not_found",
          message: "Perangkat tidak ditemukan",
        });
      if (!mayTouch(permissions, row.kind, "manage"))
        return status(403, {
          code: "forbidden",
          message: "Tidak punya akses ke layar tersebut",
        });

      const token = crypto.randomUUID();
      // The token lives only in Redis, so an unused link expires on its own and
      // a used one cannot be replayed.
      await redis.set(pairingKey(token), row.id, "EX", PAIRING_TTL_SECONDS);

      const origin = new URL(request.url).origin;
      return {
        url: `${origin}/v1/devices/pair/${token}`,
        expiresInSeconds: PAIRING_TTL_SECONDS,
      };
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "manage" },
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: {
        200: t.Object({
          url: t.String(),
          expiresInSeconds: t.Integer(),
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Mint a single-use, 15-minute pairing link" },
    }
  )

  /**
   * A device's own running texts.
   *
   * Governed by the menu owning *this device's* kind rather than by
   * `running-text`: these are the screen's content, and the caller who may
   * revoke an attendance TV is the caller who may decide what it says.
   * `refuseUnlessOwned` is the same check the rename and delete routes use.
   */
  .get(
    "/:id/run-texts",
    async ({ params, permissions, status }) => {
      const denied = await refuseUnlessOwned(params.id, permissions);
      if (denied) return status(denied.status, denied.body);
      const rows = await db
        .select({
          text: schema.deviceRunTexts.text,
          color: schema.deviceRunTexts.color,
        })
        .from(schema.deviceRunTexts)
        .where(eq(schema.deviceRunTexts.deviceId, params.id))
        .orderBy(asc(schema.deviceRunTexts.ord));
      return rows.map((r) => ({
        text: r.text,
        color: r.color as RunTextColor,
      }));
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "view" },
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      response: {
        200: t.Array(DeviceRunTextSchema),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "A device's own running texts" },
    }
  )

  /**
   * PUT rather than POST/DELETE per row: the screen edits an ordered list as a
   * whole, and `ord` is that list's position. Replacing it in one transaction
   * is also what makes "empty means follow master" reachable — sending `[]` is
   * how a device is handed back to the master list.
   */
  .put(
    "/:id/run-texts",
    async ({ params, body, permissions, status }) => {
      const denied = await refuseUnlessOwned(params.id, permissions);
      if (denied) return status(denied.status, denied.body);

      await db.transaction(async (tx) => {
        await tx
          .delete(schema.deviceRunTexts)
          .where(eq(schema.deviceRunTexts.deviceId, params.id));
        const rows = body.runTexts
          .map((r, ord) => ({
            deviceId: params.id,
            text: r.text.trim(),
            color: r.color,
            ord,
          }))
          .filter((r) => r.text.length > 0);
        if (rows.length) await tx.insert(schema.deviceRunTexts).values(rows);
      });

      const rows = await db
        .select({
          text: schema.deviceRunTexts.text,
          color: schema.deviceRunTexts.color,
        })
        .from(schema.deviceRunTexts)
        .where(eq(schema.deviceRunTexts.deviceId, params.id))
        .orderBy(asc(schema.deviceRunTexts.ord));
      return rows.map((r) => ({
        text: r.text,
        color: r.color as RunTextColor,
      }));
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "manage" },
      params: t.Object({ id: t.String({ minLength: 1 }) }),
      body: t.Object({ runTexts: t.Array(DeviceRunTextSchema) }),
      response: {
        200: t.Array(DeviceRunTextSchema),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Replace a device's own running texts" },
    }
  );

/**
 * What a display is to show (design D8).
 *
 * A device with any texts of its own shows those; a device with none shows the
 * active master list. The rule is on *having rows* rather than on a flag, which
 * is why `device_run_texts` carries no `active` column — deactivating the last
 * row and deleting it would otherwise mean two different things that look the
 * same from here.
 */
async function effectiveRunTexts(
  deviceId: string | null
): Promise<{ text: string; color: RunTextColor }[]> {
  if (deviceId) {
    const own = await db
      .select({
        text: schema.deviceRunTexts.text,
        color: schema.deviceRunTexts.color,
      })
      .from(schema.deviceRunTexts)
      .where(eq(schema.deviceRunTexts.deviceId, deviceId))
      .orderBy(asc(schema.deviceRunTexts.ord));
    if (own.length)
      return own.map((r) => ({ text: r.text, color: r.color as RunTextColor }));
  }

  const master = await db
    .select({ text: schema.runTexts.text, color: schema.runTexts.color })
    .from(schema.runTexts)
    .where(eq(schema.runTexts.active, true))
    .orderBy(asc(schema.runTexts.createdAt));
  return master.map((r) => ({ text: r.text, color: r.color as RunTextColor }));
}

/**
 * The display data a paired TV polls. Reading it *is* the heartbeat — a device
 * that has data has, by definition, just asked for it, so there is no separate
 * ping to forget to send.
 *
 * `allowDevice` widens this to device sessions; the macro still refuses them on
 * any mutating method, and on every route that does not carry the flag.
 */
export const displayRoutes = new Elysia({
  prefix: "/display",
  tags: ["display"],
})
  .use(requireAuth)
  .get(
    "/:kind",
    async ({ params, principal, status }) => {
      if (principal.kind === "device" && principal.deviceKind !== params.kind)
        return status(403, {
          code: "forbidden",
          message: "Perangkat ini bukan untuk layar tersebut",
        });

      if (principal.kind === "device") {
        await db
          .update(schema.devices)
          .set({ lastSeenAt: new Date() })
          .where(eq(schema.devices.id, principal.id));
      }

      return {
        kind: params.kind,
        device: principal.kind === "device" ? principal.id : null,
        servedAt: new Date().toISOString(),
        runTexts: await effectiveRunTexts(
          principal.kind === "device" ? principal.id : null
        ),
      };
    },
    {
      auth: { menu: DISPLAY_MENUS, mode: "view", allowDevice: true },
      params: t.Object({ kind: DeviceKindSchema }),
      response: {
        200: DisplayContentSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "Display data for a kiosk; records the heartbeat" },
    }
  );
