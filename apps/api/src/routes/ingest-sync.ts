/**
 * Manual readiness sync — the escape hatch beside the timeline.
 *
 * The scheduled ingest windows (`ftw-ingest`, `finger-ingest`) are the normal
 * path; these routes exist for pulls outside the timeline and for recovery
 * when an automated window failed. One pass, not a window: the operator
 * clicking the button wants "now", and can click again.
 *
 * Mounted under the menus that own the data (`fit-to-work`, `attendance`)
 * so the permission that shows a screen is the permission that refreshes it.
 * Sync requires `manage`; reading the status only `view`.
 */

import { sql } from "drizzle-orm";
import { Elysia } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { ingestDates, syncFingerReadings, syncFtwReadings } from "../ingest";
import {
  ErrorSchema,
  IngestSyncResultSchema,
  IngestSyncStatusSchema,
} from "./schemas";

const sourceUnreachable = {
  code: "source_unreachable",
  message: "Sumber data eksternal tidak dapat dihubungi",
};

async function lastSyncedAt(
  table: typeof schema.ftwReadings | typeof schema.fingerReadings
): Promise<string | null> {
  const [row] = await db
    .select({ at: sql<string | null>`max(${table.syncedAt})` })
    .from(table);
  return row?.at ? new Date(row.at).toISOString() : null;
}

export const fitToWorkSyncRoutes = new Elysia({
  prefix: "/fit-to-work",
  tags: ["fit-to-work"],
})
  .use(requireAuth)

  .post(
    "/sync",
    async ({ status }) => {
      try {
        const result = await syncFtwReadings(ingestDates());
        return { ...result, syncedAt: new Date().toISOString() };
      } catch (error) {
        console.error("[ingest] manual ftw sync failed", error);
        return status(502, sourceUnreachable);
      }
    },
    {
      auth: { menu: "fit-to-work", mode: "manage" },
      response: {
        200: IngestSyncResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        502: ErrorSchema,
      },
      detail: { summary: "Pull FTW verdicts from savera now (one pass)" },
    }
  )

  .get(
    "/sync-status",
    async () => ({ lastSyncedAt: await lastSyncedAt(schema.ftwReadings) }),
    {
      auth: { menu: "fit-to-work", mode: "view" },
      response: {
        200: IngestSyncStatusSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "When FTW readings last synced" },
    }
  );

export const attendanceSyncRoutes = new Elysia({
  prefix: "/attendance",
  tags: ["attendance"],
})
  .use(requireAuth)

  .post(
    "/sync",
    async ({ status }) => {
      try {
        const result = await syncFingerReadings(ingestDates());
        return { ...result, syncedAt: new Date().toISOString() };
      } catch (error) {
        console.error("[ingest] manual finger sync failed", error);
        return status(502, sourceUnreachable);
      }
    },
    {
      auth: { menu: "attendance", mode: "manage" },
      response: {
        200: IngestSyncResultSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        502: ErrorSchema,
      },
      detail: { summary: "Pull fingerprint taps from Nakula now (one pass)" },
    }
  )

  .get(
    "/sync-status",
    async () => ({ lastSyncedAt: await lastSyncedAt(schema.fingerReadings) }),
    {
      auth: { menu: "attendance", mode: "view" },
      response: {
        200: IngestSyncStatusSchema,
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "When fingerprint readings last synced" },
    }
  );
