import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { openapi } from "@elysiajs/openapi";
import { API_VERSION } from "@universe/contracts";

import { env, isProd } from "./env";
import { pingDb } from "./db";
import { pingRedis } from "./redis";
import { startScheduler } from "./scheduler";
import {
  pingImportStorage,
  pingPhotoStorage,
  pingSoundStorage,
} from "./storage";
import { authRoutes } from "./routes/auth";
import { devicesRoutes, displayRoutes } from "./routes/devices";
import { runTextsRoutes, soundsRoutes } from "./routes/display-content";
import { employeesRoutes } from "./routes/employees";
import { masterRoutes } from "./routes/master";
import { rolesRoutes } from "./routes/roles";
import { rosterRoutes } from "./routes/roster";
import { rosterImportRoutes } from "./routes/roster-import";
import { rosterRevisionRoutes } from "./routes/roster-revision";
import { timelineRoutes } from "./routes/timeline";
import { busSchedulesRoutes, unitsRoutes } from "./routes/units";
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
  .use(displayRoutes)
  .use(masterRoutes)
  .use(employeesRoutes)
  .use(rosterImportRoutes)
  .use(rosterRoutes)
  .use(rosterRevisionRoutes)
  .use(unitsRoutes)
  .use(busSchedulesRoutes)
  .use(runTextsRoutes)
  .use(soundsRoutes)
  .use(timelineRoutes);

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
          { name: "master", description: "Master lookup catalogues" },
          { name: "employees", description: "Employee register and photos" },
          {
            name: "roster",
            description: "Monthly roster documents, their days, and imports",
          },
          {
            name: "roster-revision",
            description: "Roster revision submissions and their approval",
          },
          { name: "units", description: "Unit registry" },
          { name: "bus", description: "Bus departure schedules" },
          { name: "sounds", description: "Sound clips and their audio" },
          { name: "timeline", description: "Morning allocation schedule" },
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
    const [database, cache, soundStorage, photoStorage, importStorage] =
      await Promise.all([
        pingDb(),
        pingRedis(),
        pingSoundStorage(),
        pingPhotoStorage(),
        pingImportStorage(),
      ]);
    const body = {
      ok: database && cache && soundStorage && photoStorage && importStorage,
      version: API_VERSION,
      database,
      cache,
      // A misconfigured SOUND_DIR is an unmounted volume, and the symptom
      // otherwise is the *first upload* failing — long after the deploy that
      // caused it. Reporting it here makes it a startup-time fact.
      soundStorage,
      // Same reasoning, one step worse: a lost PHOTO_DIR leaves every
      // `photo_file_name` in the database pointing at nothing.
      photoStorage,
      // The mildest of the three — nothing in the database points at it — but
      // an unwritable IMPORT_DIR turns every roster preview past its first page
      // into a 404 that reads like a bug in the importer (design D8).
      importStorage,
    };
    // 503 so a load balancer or container healthcheck actually reacts.
    return body.ok ? body : status(503, body);
  })
  .use(api)
  .listen(env.PORT);

// Runs in-process rather than as its own service: it is a minute timer and a
// Redis key, and the lock is what makes several API processes safe (design D9),
// so a separate deployable would add an operational unit for no guarantee.
startScheduler();

console.log(`[api] listening on http://localhost:${env.PORT}`);
console.log(`[api] openapi docs at http://localhost:${env.PORT}/openapi`);

/** Consumed by web/mobile through Eden Treaty. Type-only — erased at build. */
export type App = typeof app;
