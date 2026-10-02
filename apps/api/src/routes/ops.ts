/**
 * The Operations Center: a password-only, read-only page about the health of
 * the application and of this shift's muster.
 *
 * Outside roles and menus by the owner's decision (2026-10-02): it is opened
 * with its own password, not an account. Everything here therefore sits
 * behind `ops` rather than `auth` — see `ops/session.ts` for why the two
 * session kinds can never stand in for each other.
 *
 * With no `OPS_PASSWORD_HASH` configured every route answers 404, so a
 * deployment that has not decided to run this page does not have one.
 */

import { Elysia, t } from "elysia";
import {
  NOTIFICATION_KINDS,
  NOTIFICATION_TONES,
  SHIFT_KINDS,
} from "@universe/contracts";

import { clientIp } from "../ops/client-ip";
import { buildOpsOverview } from "../ops/overview";
import {
  OPS_COOKIE,
  opsCookieAttributes,
  opsEnabled,
  opsLogin,
  opsLogout,
  opsSessionValid,
} from "../ops/session";
import { DeviceKindSchema, ErrorSchema, TimelineActionSchema } from "./schemas";

export { OPS_COOKIE };

const notFound = { code: "not_found", message: "Route not found" };
const unauthenticated = {
  code: "unauthenticated",
  message: "Masukkan password Operations Center",
};

/** Guards a route behind a live ops session; 404 when the page is off. */
export const requireOps = new Elysia({ name: "ops/guard" }).macro({
  ops(enabled: boolean) {
    return {
      async resolve({ cookie, status }) {
        if (!enabled || !opsEnabled()) return status(404, notFound);
        const id = cookie[OPS_COOKIE]?.value as string | undefined;
        if (!(await opsSessionValid(id))) return status(401, unauthenticated);
        return { opsSessionId: id! };
      },
    };
  },
});

const ShiftSchema = t.UnionEnum(SHIFT_KINDS);
const Figures = {
  requests: t.Number(),
  clientErrors: t.Number(),
  serverErrors: t.Number(),
  avgMs: t.Number(),
  maxMs: t.Number(),
};
const StageRunSchema = t.Object({
  at: t.String(),
  date: t.String(),
  stageId: t.String(),
  name: t.String(),
  action: TimelineActionSchema,
  shift: t.Nullable(ShiftSchema),
  ok: t.Boolean(),
  note: t.String(),
});

const OpsOverviewSchema = t.Object({
  generatedAt: t.String(),
  date: t.String(),
  runningShift: t.Nullable(t.Object({ date: t.String(), shift: ShiftSchema })),
  checks: t.Object({
    database: t.Boolean(),
    cache: t.Boolean(),
    soundStorage: t.Boolean(),
    photoStorage: t.Boolean(),
    importStorage: t.Boolean(),
    schedulerLastTick: t.Nullable(t.String()),
    proberLastCheck: t.Nullable(t.String()),
  }),
  muster: t.Object({
    stages: t.Array(
      t.Object({
        id: t.String(),
        name: t.String(),
        action: TimelineActionSchema,
        shift: t.Nullable(ShiftSchema),
        at: t.String(),
        /** The muster this stage belongs to — yesterday's for a night under way. */
        date: t.String(),
        /** Its time on that date has arrived. */
        due: t.Boolean(),
        active: t.Boolean(),
        fired: t.Boolean(),
        lastRun: t.Nullable(
          t.Object({ at: t.String(), ok: t.Boolean(), note: t.String() })
        ),
      })
    ),
    boards: t.Array(
      t.Object({
        date: t.String(),
        shift: ShiftSchema,
        generatedAt: t.String(),
      })
    ),
    readings: t.Object({
      ftw: t.Number(),
      finger: t.Number(),
      lastTapAt: t.Nullable(t.String()),
    }),
    tickets: t.Object({
      printed: t.Number(),
      failed: t.Number(),
      dry: t.Number(),
    }),
  }),
  devices: t.Object({
    screens: t.Array(
      t.Object({
        id: t.String(),
        name: t.String(),
        kind: DeviceKindSchema,
        active: t.Boolean(),
        lastSeenAt: t.Nullable(t.String()),
        online: t.Boolean(),
      })
    ),
    machines: t.Object({
      total: t.Number(),
      online: t.Number(),
      offline: t.Array(
        t.Object({
          name: t.String(),
          ip: t.String(),
          since: t.Nullable(t.String()),
        })
      ),
    }),
    printers: t.Object({ total: t.Number(), active: t.Number() }),
    listening: t.Array(
      t.Object({
        name: t.String(),
        ip: t.String(),
        source: t.Union([t.Literal("manual"), t.Literal("schedule")]),
        startedAt: t.String(),
        taps: t.Number(),
      })
    ),
  }),
  api: t.Object({
    perMinute: t.Array(t.Object({ at: t.String(), ...Figures })),
    routes: t.Array(t.Object({ route: t.String(), ...Figures })),
    slow: t.Array(
      t.Object({
        at: t.String(),
        route: t.String(),
        status: t.Number(),
        ms: t.Number(),
      })
    ),
    errors: t.Array(
      t.Object({
        at: t.String(),
        route: t.String(),
        status: t.Number(),
        name: t.String(),
      })
    ),
  }),
  users: t.Array(
    t.Object({
      userId: t.String(),
      name: t.String(),
      nik: t.Nullable(t.String()),
      roleName: t.String(),
      ip: t.Nullable(t.String()),
      userAgent: t.Nullable(t.String()),
      lastRoute: t.String(),
      lastStatus: t.Number(),
      lastSeenAt: t.String(),
      requests: t.Number(),
      errors: t.Number(),
    })
  ),
  stageLog: t.Array(StageRunSchema),
  notifications: t.Array(
    t.Object({
      id: t.String(),
      kind: t.UnionEnum(NOTIFICATION_KINDS),
      tone: t.UnionEnum(NOTIFICATION_TONES),
      params: t.Record(t.String(), t.Unknown()),
      createdAt: t.String(),
    })
  ),
});

export const opsRoutes = new Elysia({ prefix: "/ops", tags: ["ops"] })
  .use(requireOps)
  /* The overview carries names, NIKs and addresses: never let a browser or a
     proxy keep a copy (security review, 2026-10-02). */
  .onRequest(({ request, set }) => {
    if (/^(\/v1)?\/ops\//.test(new URL(request.url).pathname))
      set.headers["cache-control"] = "no-store";
  })
  .post(
    "/session",
    async ({ body, cookie, request, server, status }) => {
      const result = await opsLogin(body.password, clientIp(request, server));
      switch (result.kind) {
        case "disabled":
          return status(404, notFound);
        case "locked":
          return status(429, {
            code: "too_many_attempts",
            message: "Terlalu banyak percobaan — coba lagi dalam 15 menit",
          });
        case "wrong":
          return status(401, {
            code: "invalid_password",
            message: "Password salah",
          });
        case "ok":
          cookie[OPS_COOKIE]!.set({
            value: result.id,
            ...opsCookieAttributes(result.maxAge),
          });
          return { ok: true };
      }
    },
    {
      body: t.Object({ password: t.String({ minLength: 1, maxLength: 200 }) }),
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        404: ErrorSchema,
        422: ErrorSchema,
        429: ErrorSchema,
      },
      detail: { summary: "Open the Operations Center with its password" },
    }
  )
  .get("/session", () => ({ ok: true }), {
    ops: true,
    response: {
      200: t.Object({ ok: t.Boolean() }),
      401: ErrorSchema,
      404: ErrorSchema,
    },
    detail: {
      summary: "Whether the caller holds an Operations Center session",
    },
  })
  .get("/overview", () => buildOpsOverview(), {
    ops: true,
    response: {
      200: OpsOverviewSchema,
      401: ErrorSchema,
      404: ErrorSchema,
    },
    detail: {
      summary: "Infrastructure, today's muster, devices, requests and users",
    },
  })
  .delete(
    "/session",
    async ({ cookie, opsSessionId }) => {
      await opsLogout(opsSessionId);
      cookie[OPS_COOKIE]!.remove();
      return { ok: true };
    },
    {
      ops: true,
      response: {
        200: t.Object({ ok: t.Boolean() }),
        401: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "Close the Operations Center session" },
    }
  );
