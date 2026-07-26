import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { API_VERSION } from "@universe/contracts";

import { env, isProd } from "./env";
import { pingDb } from "./db";
import { pingRedis } from "./redis";
import { authRoutes } from "./routes/auth";
import { devicesRoutes, displayRoutes } from "./routes/devices";
import { rolesRoutes } from "./routes/roles";
import { usersRoutes } from "./routes/users";

/**
 * Everything mounts under /v1 from day one.
 *
 * Web deploys in lockstep with this API, but a shipped mobile build does not —
 * users can sit on an old version for weeks. Adding the prefix later means
 * touching every route and every client.
 */
const api = new Elysia({ prefix: `/${API_VERSION}` })
  .use(authRoutes)
  .use(rolesRoutes)
  .use(usersRoutes)
  .use(devicesRoutes)
  .use(displayRoutes);

export const app = new Elysia()
  .use(
    cors({
      origin: env.CORS_ORIGINS,
      credentials: true,
    })
  )
  .use(
    openapi({
      documentation: {
        info: { title: "Universe API", version: "1.0.0" },
        tags: [
          { name: "auth", description: "Sessions and credentials" },
          { name: "roles", description: "Roles and permissions" },
          { name: "users", description: "Account management" },
          { name: "devices", description: "Display device registry" },
          { name: "display", description: "Kiosk data and heartbeat" },
        ],
      },
    })
  )
  .onError(({ code, error, status }) => {
    // Never leak internals to clients; log them instead.
    if (code === "VALIDATION") {
      // error.message is a giant TypeBox dump — unusable by a client. Flatten
      // it to per-field issues so web/mobile can highlight the right input.
      const issues = error.all.flatMap((issue) =>
        "path" in issue
          ? [
              {
                field: issue.path.replace(/^\//, ""),
                message: issue.summary ?? issue.message,
              },
            ]
          : []
      );
      return status(422, {
        code: "validation_failed",
        message: "Request failed validation",
        issues,
      });
    }
    if (code === "NOT_FOUND")
      return status(404, { code: "not_found", message: "Route not found" });

    console.error("[api] unhandled", error);
    return status(500, {
      code: "internal_error",
      message: isProd ? "Something went wrong" : String(error),
    });
  })
  .get("/health", async ({ status }) => {
    const [database, cache] = await Promise.all([pingDb(), pingRedis()]);
    const body = {
      ok: database && cache,
      version: API_VERSION,
      database,
      cache,
    };
    // 503 so a load balancer or container healthcheck actually reacts.
    return body.ok ? body : status(503, body);
  })
  .use(api)
  .listen(env.PORT);

console.log(`[api] listening on http://localhost:${env.PORT}`);
console.log(`[api] openapi docs at http://localhost:${env.PORT}/openapi`);

/** Consumed by web/mobile through Eden Treaty. Type-only — erased at build. */
export type App = typeof app;
