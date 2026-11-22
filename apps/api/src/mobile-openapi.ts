/**
 * The OpenAPI document the mobile app's Kotlin client is generated from
 * (docs/prd.md, Mobile app → Client stack: "The API client is generated from
 * `/openapi`").
 *
 * Built like the integration document (`integrations/openapi.ts`): an app
 * mounting only the route groups the phone reads, then cut down to the
 * operations it calls (`MOBILE_OPERATIONS`), so the generated client holds
 * nothing it never sends. Committed under `apps/mobile` (`bun run
 * openapi:mobile`), where Gradle generates from it without a running API,
 * with a test that fails when the two drift apart.
 */

import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { API_VERSION } from "@universe/contracts";

import { as30, sortedResponses } from "./openapi-30";
import { withExamples } from "./openapi-examples";
import { SHIFT_EXAMPLES } from "./mobile-openapi-examples";
import {
  documentResponses,
  ENGLISH,
  type Operation,
  type Refusals,
} from "./openapi-responses";
import { authRoutes } from "./routes/auth";
import { dashboardRoutes } from "./routes/dashboard";
import { employeesRoutes } from "./routes/employees";
import { fleetActualRoutes } from "./routes/fleet-actual";
import { idCardRoutes } from "./routes/id-card";
import {
  attendanceSyncRoutes,
  fitToWorkSyncRoutes,
} from "./routes/ingest-sync";
import { meRoutes } from "./routes/me";
import { mobileRoutes } from "./routes/mobile";
import { reportRoutes } from "./routes/reports";
import { rosterRoutes } from "./routes/roster";
import { timelineRoutes } from "./routes/timeline";
import { unitStatusRoutes } from "./routes/unit-status";
import { usersRoutes } from "./routes/users";

/** Repo-relative, where the generated document is committed. */
export const MOBILE_SPEC_PATH = "apps/mobile/openapi.json";

/**
 * Every call the app makes, as `METHOD /path`. A screen that needs another
 * route adds it here, mounts its group above, and regenerates.
 */
export const MOBILE_OPERATIONS = [
  "POST /v1/auth/login",
  "POST /v1/auth/logout",
  "GET /v1/auth/session",
  "POST /v1/auth/change-password",
  "GET /v1/mobile/version",
  "GET /v1/me/shift",
  "GET /v1/me/profile",
  "GET /v1/me/seats",
  "GET /v1/me/fit-to-work",
  "GET /v1/me/attendance",
  "GET /v1/me/notifications",
  "POST /v1/me/notifications/{id}/read",
  "POST /v1/me/notifications/read-all",
  "POST /v1/me/push-devices",
  "DELETE /v1/me/push-devices",
  "GET /v1/roster/{id}/days",
  "GET /v1/employees/{nik}",
  /* A group's own root is published with its trailing slash. The Riwayat
     tabs belong on `/me/fit-to-work` and `/me/attendance`: these two answer
     with the caller's whole scope. Kept until the app no longer calls them. */
  "GET /v1/fit-to-work/",
  "GET /v1/attendance/",
  "GET /v1/roster/",
  /* The Pengawas Lapangan's screens (stage 3, S5): the fleet wall's own board,
     unit status and its trail, and a scanned card. */
  "GET /v1/fleet-allocation/actual/display",
  "GET /v1/unit-status/",
  "GET /v1/unit-status/{code}/history",
  "GET /v1/id-card/{nik}",
  "GET /v1/id-card/{nik}/photo",
  /* The Superadmin's (S6): a hand placement as the Actual tab makes it, the
     two account actions, and the muster monitor. */
  "GET /v1/fleet-allocation/actual/{date}/{shift}/candidates/{unitId}",
  "PATCH /v1/fleet-allocation/actual/{date}/{shift}/{unitId}",
  "GET /v1/users/",
  "PATCH /v1/users/{id}",
  "POST /v1/users/{id}/reset-password",
  "GET /v1/timeline/runs",
  /* Dashboard and Laporan (S7): the dashboard's counts, which arrive only for
     the grants the caller holds, and one report at a time, view only. */
  "GET /v1/dashboard/",
  "GET /v1/reports/{kind}",
] as const;

type Json = Record<string, unknown>;

/**
 * The `code` values each operation's own route sends, per status
 * (`openapi-responses.ts` adds `validation_failed` and `internal_error`).
 * Read from the handlers; a status listed here that the route does not
 * declare fails the build of this document.
 */
const NO_EMPLOYEE: Refusals = { "404": ["no_employee"] };
const REFUSALS: Partial<Record<(typeof MOBILE_OPERATIONS)[number], Refusals>> =
  {
    "POST /v1/auth/login": {
      "401": ["invalid_credentials"],
      "403": ["first_login_on_site"],
      "429": ["too_many_attempts"],
    },
    "POST /v1/auth/change-password": {
      "401": ["invalid_credentials"],
      "403": ["forbidden"],
      "422": ["password_too_short", "password_is_default"],
    },
    "GET /v1/me/shift": NO_EMPLOYEE,
    "GET /v1/me/profile": NO_EMPLOYEE,
    "GET /v1/me/seats": { ...NO_EMPLOYEE, "422": ["invalid_range"] },
    "GET /v1/me/fit-to-work": { ...NO_EMPLOYEE, "422": ["invalid_range"] },
    "GET /v1/me/attendance": { ...NO_EMPLOYEE, "422": ["invalid_range"] },
    "GET /v1/me/notifications": NO_EMPLOYEE,
    "POST /v1/me/notifications/{id}/read": {
      "404": ["no_employee", "not_found"],
    },
    "POST /v1/me/notifications/read-all": NO_EMPLOYEE,
    "POST /v1/me/push-devices": NO_EMPLOYEE,
    "DELETE /v1/me/push-devices": NO_EMPLOYEE,
    "GET /v1/roster/{id}/days": { "404": ["roster_document_not_found"] },
    "GET /v1/employees/{nik}": { "404": ["employee_not_found"] },
    "GET /v1/fit-to-work/": { "422": ["invalid_range"] },
    "GET /v1/attendance/": { "422": ["invalid_range"] },
    "GET /v1/fleet-allocation/actual/display": {
      "404": ["device_not_found"],
    },
    "GET /v1/fleet-allocation/actual/{date}/{shift}/candidates/{unitId}": {
      "404": ["board_not_found", "unit_not_found"],
    },
    "PATCH /v1/fleet-allocation/actual/{date}/{shift}/{unitId}": {
      "404": ["board_not_found", "slot_not_found"],
      "409": ["already_placed"],
      "422": ["ftw_acknowledgement_required"],
    },
    "GET /v1/unit-status/{code}/history": { "404": ["unit_not_found"] },
    "GET /v1/id-card/{nik}": { "404": ["employee_not_found"] },
    "GET /v1/id-card/{nik}/photo": { "404": ["photo_not_found"] },
    "PATCH /v1/users/{id}": {
      "404": ["user_not_found"],
      "409": ["own_account", "last_roles_admin", "email_taken", "nik_taken"],
      "422": [
        "identifier_required",
        "nik_not_registered",
        "role_not_found",
        "scope_requires_nik",
      ],
    },
    "POST /v1/users/{id}/reset-password": {
      "404": ["user_not_found"],
      "409": ["own_account"],
    },
    "GET /v1/reports/{kind}": {
      "422": [
        "department_not_found",
        "today_only",
        "missing_date",
        "missing_shift",
        "no_deadline",
      ],
    },
  };

/**
 * Every success with a real value in each field (`openapi-examples.ts`), and
 * `/me/shift` with one named example per Beranda state.
 */
function successExamples(
  name: string,
  responses: Record<string, Json>
): Record<string, Json> {
  return Object.fromEntries(
    Object.entries(responses).map(([status, response]) => {
      const media = (response.content as Record<string, Json> | undefined)?.[
        "application/json"
      ];
      if (!status.startsWith("2") || !media) return [status, response];
      return [
        status,
        {
          ...response,
          content: {
            "application/json": {
              ...media,
              schema: withExamples(media.schema),
              ...(name === "GET /v1/me/shift"
                ? { examples: SHIFT_EXAMPLES }
                : {}),
            },
          },
        },
      ];
    })
  );
}

/** Operations whose success body is an image the route streams from disk. */
const IMAGES = new Set(["GET /v1/id-card/{nik}/photo"]);

/**
 * An image's 200 under `image/*`. Elysia files every non-object body under
 * `text/plain`, and a client generated from that would read a face as text.
 */
function asImage(
  name: string,
  responses: Record<string, Json>
): Record<string, Json> {
  const ok = responses["200"] as { content?: Record<string, Json> } | undefined;
  const body = ok?.content?.["text/plain"];
  if (!IMAGES.has(name) || !body) return responses;
  return { ...responses, "200": { ...ok, content: { "image/*": body } } };
}

/** No session asked for: the app reaches these before it has one. */
const PUBLIC = new Set(["POST /v1/auth/login", "GET /v1/mobile/version"]);
/**
 * The `session` macro (`routes/auth.ts`): a session, and nothing more, so an
 * account still on the issued password can log out and change it.
 */
const SESSION_ONLY = new Set([
  "POST /v1/auth/logout",
  "GET /v1/auth/session",
  "POST /v1/auth/change-password",
]);

/** What the gate in front of an operation answers before its route runs. */
function gateOf(name: string): Refusals {
  if (PUBLIC.has(name)) return {};
  if (SESSION_ONLY.has(name)) return { "401": ["unauthenticated"] };
  /* `auth` (a menu) and `self` (`/me`) alike (`auth/macro.ts`). */
  return {
    "401": ["unauthenticated"],
    "403": ["forbidden", "password_change_required"],
  };
}

/**
 * A response as an installed build must read it, now and after the API grows:
 *
 * - Without `enum`. A sideloaded build stays in use for weeks (docs/prd.md,
 *   Mobile app → Client stack); a generated enum fails to read the whole
 *   answer the day the API adds a value, where a string the app does not
 *   recognise is one it can still show. The app maps the strings it knows.
 * - Without `default`. TypeBox writes an enum's first member as its default,
 *   which the route never applies; a generated model would take "absent" to
 *   mean `plan` or `breakdown`.
 *
 * Request schemas keep both: what the app sends is checked by this API.
 */
function asOpenResponse(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(asOpenResponse);
  if (!node || typeof node !== "object") return node;
  return Object.fromEntries(
    Object.entries(node)
      .filter(([key]) => key !== "default" && key !== "enum")
      .map(([key, value]) => [
        key,
        /* Field names, not keywords: a field called `enum` stays. */
        key === "properties"
          ? Object.fromEntries(
              Object.entries(value as Json).map(([name, schema]) => [
                name,
                asOpenResponse(schema),
              ])
            )
          : asOpenResponse(value),
      ])
  );
}

/**
 * `/auth/session` answers a person or a paired TV. The app only ever holds a
 * person's session, so its client reads the person's branch alone; a union a
 * generator merges into one class would make a TV's fields required.
 */
function asPersonSession(
  operation: Json & { responses: Record<string, Json> }
) {
  const ok = operation.responses["200"] as {
    content: Record<string, { schema: { properties: Json } }>;
  };
  const properties = ok.content["application/json"]!.schema.properties;
  const principal = properties.principal as { anyOf?: Json[] };
  const person = principal.anyOf?.find(
    (branch) =>
      ((branch.properties as Json | undefined)?.kind as Json | undefined)
        ?.const === "user"
  );
  if (person) properties.principal = person;
  return operation;
}

export async function buildMobileSpec(): Promise<Json> {
  const app = new Elysia()
    .use(
      openapi({
        documentation: {
          info: { title: "Universe Mobile API", version: "1.0.0" },
          components: {
            securitySchemes: {
              session: {
                type: "http",
                scheme: "bearer",
                description:
                  "The `sessionId` a login with `transport: bearer` returns",
              },
            },
          },
        },
      })
    )
    .use(
      new Elysia({ prefix: `/${API_VERSION}` })
        .use(authRoutes)
        .use(mobileRoutes)
        .use(meRoutes)
        .use(rosterRoutes)
        .use(employeesRoutes)
        .use(fitToWorkSyncRoutes)
        .use(attendanceSyncRoutes)
        .use(fleetActualRoutes)
        .use(unitStatusRoutes)
        .use(idCardRoutes)
        .use(usersRoutes)
        .use(timelineRoutes)
        .use(dashboardRoutes)
        .use(reportRoutes)
    );

  const response = await app.handle(
    new Request("http://localhost/openapi/json")
  );
  const spec = (await response.json()) as Json & {
    paths: Record<
      string,
      Record<string, Json & { responses: Record<string, Json> }>
    >;
  };

  const wanted = new Set<string>(MOBILE_OPERATIONS);
  const paths: Json = {};
  for (const [path, methods] of Object.entries(spec.paths)) {
    const kept = Object.fromEntries(
      Object.entries(methods)
        .filter(([method]) => wanted.has(`${method.toUpperCase()} ${path}`))
        .map(([method, raw]) => {
          const operation =
            path === "/v1/auth/session"
              ? asPersonSession(structuredClone(raw))
              : raw;
          /* Opened after the 3.0 rewrite, which turns a literal into an enum. */
          const name = `${method.toUpperCase()} ${path}`;
          const in30 = documentResponses(
            as30(operation) as Operation,
            ENGLISH,
            REFUSALS[name as keyof typeof REFUSALS],
            gateOf(name)
          );
          return [
            method,
            {
              ...in30,
              responses: asOpenResponse(
                sortedResponses(
                  asImage(name, successExamples(name, in30.responses))
                )
              ),
            },
          ];
        })
    );
    if (Object.keys(kept).length) paths[path] = kept;
  }
  return {
    ...spec,
    paths,
    components: as30(spec.components),
  };
}
