/**
 * The authorization boundary (design D7 and D10).
 *
 * Every guarded route declares the menu slug and mode it requires; the macro
 * resolves the session, loads the cached principal and permission set, and
 * injects `principal`. Declaring it per route is also what keeps the generated
 * OpenAPI spec accurate, which is what a mobile client generates from.
 *
 * The web middleware and shell are user experience. This is the boundary.
 */

import { Elysia } from "elysia";
import {
  PASSWORD_CHANGE_REQUIRED,
  type AccessMode,
  type EffectivePermissions,
  type MenuSlug,
  type SessionPrincipal,
} from "@universe/contracts";

import {
  loadDevice,
  loadPermissions,
  loadUser,
  type CachedUser,
} from "./principal";
import { DEVICE_COOKIE, resolveSession, SESSION_COOKIE } from "./session";

export type AuthOptions = {
  /**
   * The menu this route belongs to. A list means any one of them authorizes it —
   * the device registry, for instance, is reachable from either display menu,
   * and the handler narrows further by the device's own kind.
   */
  menu: MenuSlug | MenuSlug[];
  mode: AccessMode;
  /**
   * Display data only. A device session is still refused on any mutating
   * method, so this widens reads and nothing else.
   */
  allowDevice?: boolean;
};

/** `manage` satisfies a `view` requirement; `view` never satisfies `manage`. */
function satisfies(held: AccessMode | undefined, need: AccessMode): boolean {
  if (held === undefined) return false;
  return need === "view" ? true : held === "manage";
}

function granted(
  permissions: EffectivePermissions,
  options: AuthOptions
): boolean {
  const menus = Array.isArray(options.menu) ? options.menu : [options.menu];
  return menus.some((m) => satisfies(permissions[m], options.mode));
}

const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

type SessionSource = {
  cookie: Record<string, { value?: string | undefined } | undefined>;
  headers: Record<string, string | undefined>;
};

/** Cookie and bearer carry the same opaque id and resolve identically. */
function presentedIds({ cookie, headers }: SessionSource): {
  user: string | null;
  device: string | null;
} {
  const bearer = headers.authorization?.startsWith("Bearer ")
    ? headers.authorization.slice("Bearer ".length).trim()
    : null;
  return {
    user: cookie[SESSION_COOKIE]?.value ?? bearer ?? null,
    device: cookie[DEVICE_COOKIE]?.value ?? null,
  };
}

const unauthorized = { code: "unauthenticated", message: "Sesi tidak valid" };
const forbidden = { code: "forbidden", message: "Akses ditolak" };

export function toPrincipal(user: CachedUser): SessionPrincipal {
  return {
    kind: "user",
    id: user.id,
    name: user.name,
    email: user.email,
    nik: user.nik,
    roleId: user.roleId,
    roleName: user.roleName,
    scope: user.scope,
    mustChangePassword: user.mustChangePassword,
  };
}

/**
 * Resolves whichever session is presented, without checking permissions.
 * Used by logout, session, and change-password — the three routes that must
 * stay reachable while `mustChangePassword` holds.
 */
export const requireSession = new Elysia({ name: "auth/session" }).macro({
  // The resolve is returned unconditionally, and `enabled` is honoured inside
  // it. Short-circuiting the macro itself — `if (!enabled) return` — makes it
  // infer as `undefined | { resolve }`, and the injected properties then vanish
  // from every handler's context.
  session(enabled: boolean) {
    return {
      async resolve({ cookie, headers, status }) {
        if (!enabled) return status(401, unauthorized);
        const ids = presentedIds({ cookie, headers } as SessionSource);

        if (ids.user) {
          const record = await resolveSession(ids.user);
          if (record?.kind === "user") {
            const user = await loadUser(record.subjectId);
            // Deactivation takes effect on the next request, not at expiry.
            if (!user || !user.active) return status(401, unauthorized);
            return {
              sessionId: ids.user,
              principal: toPrincipal(user),
            };
          }
        }

        if (ids.device) {
          const record = await resolveSession(ids.device);
          if (record?.kind === "device") {
            const device = await loadDevice(record.subjectId);
            if (!device || !device.active) return status(401, unauthorized);
            return {
              sessionId: ids.device,
              principal: {
                kind: "device" as const,
                id: device.id,
                name: device.name,
                deviceKind: device.kind,
              },
            };
          }
        }

        return status(401, unauthorized);
      },
    };
  },
});

/**
 * The permission gate. 401 without a session, 403 without the grant — never the
 * other way round, so an unauthenticated caller is told to log in rather than
 * that it lacks a permission it might well hold.
 */
export const requireAuth = new Elysia({ name: "auth/macro" }).macro({
  auth(options: AuthOptions) {
    return {
      async resolve({ cookie, headers, request, status }) {
        const ids = presentedIds({ cookie, headers } as SessionSource);
        const mutating = !READ_METHODS.has(request.method);

        if (ids.user) {
          const record = await resolveSession(ids.user);
          if (record?.kind === "user") {
            const user = await loadUser(record.subjectId);
            if (!user || !user.active) return status(401, unauthorized);

            // Authenticates fine, refused everywhere but logout / session /
            // change-password — which do not carry this macro.
            if (user.mustChangePassword)
              return status(403, {
                code: PASSWORD_CHANGE_REQUIRED,
                message: "Ganti password sebelum melanjutkan",
              });

            const permissions = await loadPermissions(user.roleId);
            if (!granted(permissions, options)) return status(403, forbidden);

            return { principal: toPrincipal(user), permissions };
          }
        }

        if (ids.device) {
          const record = await resolveSession(ids.device);
          if (record?.kind === "device") {
            const device = await loadDevice(record.subjectId);
            if (!device || !device.active) return status(401, unauthorized);
            // A device is read-only and confined to display routes: refused on
            // anything not marked, and on any write regardless of path.
            if (!options.allowDevice || mutating) return status(403, forbidden);
            return {
              principal: {
                kind: "device" as const,
                id: device.id,
                name: device.name,
                deviceKind: device.kind,
              },
              permissions: {},
            };
          }
        }

        return status(401, unauthorized);
      },
    };
  },
});
