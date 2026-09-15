/**
 * Which machines we are listening to, right now.
 *
 * A live session is a held TCP socket, so the set of them is process state,
 * not a table: if this process dies the sockets die with it, and a row that
 * outlived them would describe a session nobody is holding. That is also the
 * answer to "what happens on restart" — every manual listen ends, deliberately
 * (owner, 2026-09-13), rather than coming back without anybody asking.
 *
 * **Only machines flagged `universeOnly` may be listened to.** Listening sends
 * `CMD_ENABLE_DEVICE`, which changes the machine's state, and the production
 * machines belong to ShiftCorner. The rule is enforced here rather than in the
 * screen, because a screen that hides a button is a suggestion and this is a
 * promise (owner, 2026-09-13).
 */

import { and, eq, lt, sql } from "drizzle-orm";

import { db, schema } from "./db";
import { env } from "./env";
import { deriveSoon } from "./derive";
import { issueTicket } from "./ticket-issue";
import {
  openLiveSession,
  type LiveSession,
  type OpenLive,
} from "./sources/fingerprint-live";

/** Three days, the same window `device_taps` keeps and for the same reason. */
const KEEP_DAYS = 3;

export type ListenSource = "manual" | "schedule";

export type ActiveListen = {
  machineId: string;
  ip: string;
  name: string;
  source: ListenSource;
  /** Who pressed start. Null for a session the schedule opened. */
  startedBy: string | null;
  startedAt: string;
  taps: number;
};

type Held = ActiveListen & { session: LiveSession };

/** Keyed by IP: one machine, one conversation. */
const held = new Map<string, Held>();

/** Why a listen was refused, in the shape a route turns into a status. */
export class ListenRefused extends Error {
  constructor(
    readonly code:
      | "machine_not_found"
      | "machine_inactive"
      | "machine_not_universe"
      | "already_listening",
    message: string
  ) {
    super(message);
  }
}

/** The held session dropped: a socket is not something a route may hand out. */
const listed = (entry: Held): ActiveListen => ({
  machineId: entry.machineId,
  ip: entry.ip,
  name: entry.name,
  source: entry.source,
  startedBy: entry.startedBy,
  startedAt: entry.startedAt,
  taps: entry.taps,
});

export const activeListens = (): ActiveListen[] =>
  [...held.values()].map(listed).sort((a, b) => a.name.localeCompare(b.name));

export const isListening = (ip: string) => held.has(ip);

/** Tests only: drop the registry without touching a socket. */
export const forgetListens = () => held.clear();

/**
 * Which muster a tap belongs to, from its own clock.
 *
 * Noon splits the day here exactly as it splits a reading in `readiness.ts`: a
 * tap before noon is the morning's, after it the afternoon's. Taking the shift
 * from the tap rather than from the clock on the wall means a ticket issued a
 * moment after midnight still belongs to the muster the person tapped in.
 */
function ticketTapOf(ip: string, tap: { nik: string; at: string }) {
  return {
    ip,
    nik: tap.nik,
    at: tap.at,
    date: tap.at.slice(0, 10),
    shift: (tap.at.slice(11, 19) < "12:00:00" ? "day" : "night") as
      "day" | "night",
  };
}

async function recordTap(ip: string, nik: string, at: string) {
  /* Replays are the normal case on a reconnect, not the exception. */
  await db
    .insert(schema.deviceLiveEvents)
    .values({ ip, nik, at })
    .onConflictDoNothing();
}

/**
 * Start listening to one machine.
 *
 * `open` is injectable so the registry can be tested without a device — the
 * same bargain `device-taps.ts` strikes with its client.
 */
export async function startListening(input: {
  machineId: string;
  source: ListenSource;
  startedBy: string | null;
  open?: OpenLive;
}): Promise<ActiveListen> {
  const [machine] = await db
    .select()
    .from(schema.fingerprintMachines)
    .where(eq(schema.fingerprintMachines.id, input.machineId))
    .limit(1);

  if (!machine)
    throw new ListenRefused("machine_not_found", "Mesin tidak ditemukan");
  if (!machine.active)
    throw new ListenRefused("machine_inactive", "Mesin sedang nonaktif");
  if (!machine.universeOnly)
    throw new ListenRefused(
      "machine_not_universe",
      "Mesin ini bukan mesin khusus Universe — mendengarkan langsung akan menyentuh mesin produksi"
    );
  if (held.has(machine.ip))
    throw new ListenRefused("already_listening", "Mesin ini sudah didengarkan");

  /* Swept once when a session opens rather than on every tap: the window is
     three days and a muster is two hours, so once is enough and a tap should
     not wait behind a delete. */
  await db
    .delete(schema.deviceLiveEvents)
    .where(
      lt(
        schema.deviceLiveEvents.at,
        sql`now() - ${`${KEEP_DAYS} days`}::interval`
      )
    );

  const entry: Held = {
    machineId: machine.id,
    ip: machine.ip,
    name: machine.name,
    source: input.source,
    startedBy: input.startedBy,
    startedAt: new Date().toISOString(),
    taps: 0,
    session: { ip: machine.ip, stop: async () => {} },
  };

  const session = await (input.open ?? openLiveSession)({
    ip: machine.ip,
    comKey: machine.comKey,
    onTap: (tap) => {
      entry.taps += 1;
      /* Never awaited into the socket's path: a slow write must not stall the
         next tap, and a failed one must not kill the session. */
      void recordTap(machine.ip, tap.nik, tap.at)
        .then(() => {
          /* The walls and the board read the derived reading; without this a
             live tap reached it only when a pull happened to store something
             (2026-09-15). Fired, not awaited: the slip must not wait on it. */
          deriveSoon(tap.at.slice(0, 10)).catch((error) =>
            console.error("[taps] bacaan gagal diturunkan ulang", error)
          );
          return issueTicket(ticketTapOf(machine.ip, tap));
        })
        .then((result) => {
          if (result.issued)
            console.log(
              `[tiket] ${tap.nik} — ${result.status}${result.error ? ` (${result.error})` : ""}`
            );
        })
        .catch((error) => console.error("[tiket] gagal menerbitkan", error));
    },
    onClosed: () => {
      held.delete(machine.ip);
    },
  });

  entry.session = session;
  held.set(machine.ip, entry);
  return listed(entry);
}

/** Stop one. Quiet when it was not running — stopping twice is not an error. */
export async function stopListening(ip: string): Promise<boolean> {
  const entry = held.get(ip);
  if (!entry) return false;
  held.delete(ip);
  await entry.session.stop();
  return true;
}

/** Stop everything. Used when the process is shutting down. */
export async function stopAllListens(): Promise<void> {
  await Promise.all([...held.keys()].map((ip) => stopListening(ip)));
}

/** Machines a listen may be started on, for the picker. */
export async function listenableMachines() {
  const rows = await db
    .select({
      id: schema.fingerprintMachines.id,
      name: schema.fingerprintMachines.name,
      ip: schema.fingerprintMachines.ip,
    })
    .from(schema.fingerprintMachines)
    .where(
      and(
        eq(schema.fingerprintMachines.active, true),
        eq(schema.fingerprintMachines.universeOnly, true)
      )
    )
    .orderBy(schema.fingerprintMachines.name);
  return rows.map((r) => ({ ...r, listening: held.has(r.ip) }));
}

/** The booths a scheduled window is responsible for. */
async function boothsToHear() {
  return db
    .select({
      id: schema.fingerprintMachines.id,
      ip: schema.fingerprintMachines.ip,
      name: schema.fingerprintMachines.name,
    })
    .from(schema.fingerprintMachines)
    .where(
      and(
        eq(schema.fingerprintMachines.active, true),
        eq(schema.fingerprintMachines.universeOnly, true),
        eq(schema.fingerprintMachines.operatorBooth, true)
      )
    );
}

/** Close every session the schedule opened, leaving manual ones alone. */
export async function stopScheduledListens(): Promise<number> {
  const scheduled = [...held.values()].filter((h) => h.source === "schedule");
  await Promise.all(scheduled.map((h) => stopListening(h.ip)));
  return scheduled.length;
}

/**
 * Hold the booths open for a muster.
 *
 * Reconciles rather than reacts: every few seconds it asks which booths are
 * not being heard and opens those. One loop therefore covers three things that
 * would otherwise be three mechanisms — the first open, a reconnect after the
 * network drops, and a machine that was simply switched on late.
 *
 * A machine that refuses is counted and skipped, never fatal to the window:
 * one machine ending a muster's collection is a mistake this codebase has
 * already made once (see `device-taps.ts`).
 *
 * A booth already held by a *manual* listen is left as it is — one machine,
 * one conversation — and that session keeps running when the window closes,
 * because somebody asked for it by hand.
 */
export async function runListenWindow(
  endsAt: Date,
  options: { open?: OpenLive; everyMs?: number } = {}
): Promise<{ opened: number; failed: number }> {
  const everyMs = options.everyMs ?? env.DEVICE_LISTEN_RETRY_SECONDS * 1000;
  let opened = 0;
  let failed = 0;

  for (;;) {
    const booths = await boothsToHear();
    for (const booth of booths) {
      if (held.has(booth.ip)) continue;
      try {
        await startListening({
          machineId: booth.id,
          source: "schedule",
          startedBy: null,
          open: options.open,
        });
        opened += 1;
      } catch (error) {
        failed += 1;
        console.error(
          `[listen] ${booth.name} (${booth.ip}) tidak bisa didengarkan`,
          error
        );
      }
    }
    if (Date.now() + everyMs >= endsAt.getTime()) break;
    await Bun.sleep(everyMs);
  }

  const closed = await stopScheduledListens();
  console.log(
    `[listen] jendela tutup — ${opened} sesi dibuka, ${failed} gagal, ${closed} ditutup`
  );
  return { opened, failed };
}
