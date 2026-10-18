/**
 * Compose the Operations Center's one payload.
 *
 * Read-only throughout: every figure here is something the application
 * already keeps — the health probes, the timeline and the scheduler's claims,
 * the boards, readings and tickets, the device registry — plus the request
 * metrics and stage log `ops/` records. Nothing is pulled from an external
 * source and nothing is written.
 *
 * One request rather than one per panel, like the dashboard: the page polls,
 * and a dozen round trips every fifteen seconds would cost more than the page
 * is worth.
 */

import { asc, count, desc, eq, inArray, max, sql } from "drizzle-orm";

import { db, pingDb, schema } from "../db";
import { activeListens } from "../live-listener";
import { pingRedis } from "../redis";
import { localDate } from "../scheduler";
import {
  pingImportStorage,
  pingPhotoStorage,
  pingSoundStorage,
} from "../storage";
import { readOpsMetrics } from "./metrics";
import { readMusterStages } from "./muster-stages";

/** A TV is online when it polled within this window — the devices route's rule. */
const SCREEN_ONLINE_SECONDS = 3 * 60;

const iso = (value: Date | null | undefined) =>
  value ? value.toISOString() : null;

export async function buildOpsOverview(now = new Date()) {
  const [
    database,
    cache,
    soundStorage,
    photoStorage,
    importStorage,
    metrics,
    { date, runningShift, schedulerLastTick, stageLog, stages },
  ] = await Promise.all([
    pingDb(),
    pingRedis(),
    pingSoundStorage(),
    pingPhotoStorage(),
    pingImportStorage(),
    readOpsMetrics(now.getTime()),
    readMusterStages(now),
  ]);
  /* The night muster under way before dawn began yesterday, so its board is
     filed under yesterday's date. */
  const yesterday = localDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  const [
    boards,
    [ftw],
    [finger],
    [taps],
    ticketRows,
    screens,
    machines,
    [printers],
    notifications,
  ] = await Promise.all([
    db
      .select({
        date: schema.fleetActualDocuments.date,
        shift: schema.fleetActualDocuments.shift,
        generatedAt: schema.fleetActualDocuments.generatedAt,
      })
      .from(schema.fleetActualDocuments)
      .where(inArray(schema.fleetActualDocuments.date, [yesterday, date]))
      .orderBy(desc(schema.fleetActualDocuments.generatedAt)),
    db
      .select({ n: count() })
      .from(schema.ftwReadings)
      .where(eq(schema.ftwReadings.date, date)),
    db
      .select({ n: count() })
      .from(schema.fingerReadings)
      .where(eq(schema.fingerReadings.date, date)),
    db.select({ last: max(schema.deviceTaps.at) }).from(schema.deviceTaps),
    db
      .select({ status: schema.tickets.status, n: count() })
      .from(schema.tickets)
      .where(eq(schema.tickets.date, date))
      .groupBy(schema.tickets.status),
    db
      .select({
        id: schema.devices.id,
        name: schema.devices.name,
        kind: schema.devices.kind,
        active: schema.devices.active,
        lastSeenAt: schema.devices.lastSeenAt,
      })
      .from(schema.devices)
      .orderBy(asc(schema.devices.name)),
    db
      .select({
        name: schema.fingerprintMachines.name,
        ip: schema.fingerprintMachines.ip,
        online: schema.fingerprintMachines.online,
        checkedAt: schema.fingerprintMachines.checkedAt,
        statusSince: schema.fingerprintMachines.statusSince,
      })
      .from(schema.fingerprintMachines)
      .where(eq(schema.fingerprintMachines.active, true))
      .orderBy(asc(schema.fingerprintMachines.name)),
    db
      .select({
        total: count(),
        active: sql<number>`count(*) filter (where ${schema.printers.active})`,
      })
      .from(schema.printers),
    db
      .select({
        id: schema.notifications.id,
        kind: schema.notifications.kind,
        tone: schema.notifications.tone,
        params: schema.notifications.params,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .orderBy(desc(schema.notifications.createdAt))
      .limit(10),
  ]);

  const tickets = { printed: 0, failed: 0, dry: 0 };
  for (const row of ticketRows) tickets[row.status] = Number(row.n);

  const onlineMachines = machines.filter((m) => m.online);
  const lastProbe = machines.reduce<Date | null>(
    (latest, m) =>
      m.checkedAt && (!latest || m.checkedAt > latest) ? m.checkedAt : latest,
    null
  );

  return {
    generatedAt: now.toISOString(),
    date,
    runningShift,
    checks: {
      database,
      cache,
      soundStorage,
      photoStorage,
      importStorage,
      schedulerLastTick,
      proberLastCheck: iso(lastProbe),
    },
    muster: {
      /* Each stage on the date of the muster it belongs to, and whether it
         fired there: the scheduler's own claim, not a guess from the clock. */
      stages,
      boards: boards.map((board) => ({
        date: board.date,
        shift: board.shift,
        generatedAt: board.generatedAt.toISOString(),
      })),
      readings: {
        ftw: Number(ftw?.n ?? 0),
        finger: Number(finger?.n ?? 0),
        lastTapAt: taps?.last ? new Date(taps.last).toISOString() : null,
      },
      tickets,
    },
    devices: {
      screens: screens.map((screen) => ({
        id: screen.id,
        name: screen.name,
        kind: screen.kind,
        active: screen.active,
        lastSeenAt: iso(screen.lastSeenAt),
        online:
          screen.active &&
          screen.lastSeenAt !== null &&
          now.getTime() - screen.lastSeenAt.getTime() <
            SCREEN_ONLINE_SECONDS * 1000,
      })),
      machines: {
        total: machines.length,
        online: onlineMachines.length,
        offline: machines
          .filter((m) => !m.online)
          .map((m) => ({
            name: m.name,
            ip: m.ip,
            since: iso(m.statusSince),
          })),
      },
      printers: {
        total: Number(printers?.total ?? 0),
        active: Number(printers?.active ?? 0),
      },
      /* This process's own sessions: listening is held in memory by whichever
         API process opened it. */
      listening: activeListens().map((listen) => ({
        name: listen.name,
        ip: listen.ip,
        source: listen.source,
        startedAt: listen.startedAt,
        taps: listen.taps,
      })),
    },
    api: {
      perMinute: metrics.perMinute,
      routes: metrics.routes,
      slow: metrics.slow,
      errors: metrics.errors,
    },
    users: metrics.users,
    stageLog,
    notifications: notifications.map((row) => ({
      id: row.id,
      kind: row.kind,
      tone: row.tone,
      params: row.params as Record<string, unknown>,
      createdAt: row.createdAt.toISOString(),
    })),
  };
}

export type OpsOverview = Awaited<ReturnType<typeof buildOpsOverview>>;
