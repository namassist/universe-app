/**
 * The registry of live sessions: who may be listened to, and what a tap does.
 *
 * The session itself is opened through an injected function, so none of this
 * touches a machine. What is under test is the promise that matters — a
 * production machine is refused here, in the server, not merely hidden on a
 * screen.
 *
 * Needs the dev Postgres:
 *   bun --env-file=.env test src/live-listener.test.ts
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { eq, inArray } from "drizzle-orm";

import { db, schema } from "./db";
import {
  activeListens,
  runListenWindow,
  forgetListens,
  listenableMachines,
  ListenRefused,
  startListening,
  stopListening,
} from "./live-listener";
import type { LiveTap, OpenLive } from "./sources/fingerprint-live";

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Live ${uid()}`;
const made = { machines: [] as string[], ips: [] as string[] };

/** Documentation range — never a real machine on site. */
const ipOf = (last: number) => `203.0.113.${last}`;

async function addMachine(options: {
  last: number;
  universeOnly?: boolean;
  active?: boolean;
  booth?: boolean;
}) {
  const ip = ipOf(options.last);
  const [row] = await db
    .insert(schema.fingerprintMachines)
    .values({
      name: `${tag} ${options.last}`,
      ip,
      universeOnly: options.universeOnly ?? true,
      active: options.active ?? true,
      operatorBooth: options.booth ?? false,
    })
    .returning({ id: schema.fingerprintMachines.id });
  made.machines.push(row!.id);
  made.ips.push(ip);
  return { id: row!.id, ip };
}

/** A session that never opens a socket; the test drives the taps by hand. */
function fakeOpener() {
  let emit: ((tap: LiveTap) => void) | null = null;
  let stopped = 0;
  const open: OpenLive = async ({ onTap }) => {
    emit = onTap;
    return { ip: "fake", stop: async () => void (stopped += 1) };
  };
  return {
    open,
    tap: (tap: LiveTap) => emit?.(tap),
    get stopped() {
      return stopped;
    },
  };
}

beforeEach(async () => {
  forgetListens();
  if (made.ips.length)
    await db
      .delete(schema.deviceLiveEvents)
      .where(inArray(schema.deviceLiveEvents.ip, made.ips));
});

afterAll(async () => {
  forgetListens();
  if (made.ips.length)
    await db
      .delete(schema.deviceLiveEvents)
      .where(inArray(schema.deviceLiveEvents.ip, made.ips));
  if (made.machines.length)
    await db
      .delete(schema.fingerprintMachines)
      .where(inArray(schema.fingerprintMachines.id, made.machines));
});

describe("who may be listened to", () => {
  /*
   * The whole reason the flag exists. Listening enables the device, and the
   * production machines are ShiftCorner's — a screen that hides the button is
   * a suggestion, this is the promise.
   */
  test("a production machine is refused by the server", async () => {
    const machine = await addMachine({ last: 61, universeOnly: false });
    const fake = fakeOpener();
    expect(
      startListening({
        machineId: machine.id,
        source: "manual",
        startedBy: "uji",
        open: fake.open,
      })
    ).rejects.toThrow(ListenRefused);
  });

  test("an inactive machine is refused", async () => {
    const machine = await addMachine({ last: 62, active: false });
    const fake = fakeOpener();
    expect(
      startListening({
        machineId: machine.id,
        source: "manual",
        startedBy: "uji",
        open: fake.open,
      })
    ).rejects.toThrow(ListenRefused);
  });

  test("only Universe-only machines are offered", async () => {
    const mine = await addMachine({ last: 63 });
    await addMachine({ last: 64, universeOnly: false });
    const offered = await listenableMachines();
    const ips = offered.map((m) => m.ip);
    expect(ips).toContain(mine.ip);
    expect(ips).not.toContain(ipOf(64));
  });
});

describe("a session while it runs", () => {
  test("is listed with who started it, and refuses a second start", async () => {
    const machine = await addMachine({ last: 65 });
    const fake = fakeOpener();
    const started = await startListening({
      machineId: machine.id,
      source: "manual",
      startedBy: "Budi",
      open: fake.open,
    });
    expect(started.startedBy).toBe("Budi");
    expect(activeListens().map((s) => s.ip)).toContain(machine.ip);

    expect(
      startListening({
        machineId: machine.id,
        source: "manual",
        startedBy: "Budi",
        open: fake.open,
      })
    ).rejects.toThrow(ListenRefused);
  });

  test("a tap is written down, and a replay writes nothing twice", async () => {
    const machine = await addMachine({ last: 66 });
    const fake = fakeOpener();
    await startListening({
      machineId: machine.id,
      source: "manual",
      startedBy: "uji",
      open: fake.open,
    });

    fake.tap({ nik: "990001", at: "2026-09-13 04:31:02" });
    fake.tap({ nik: "990001", at: "2026-09-13 04:31:02" });
    await Bun.sleep(60);

    const rows = await db
      .select()
      .from(schema.deviceLiveEvents)
      .where(eq(schema.deviceLiveEvents.ip, machine.ip));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.nik).toBe("990001");
  });

  test("stopping closes the session and forgets it", async () => {
    const machine = await addMachine({ last: 67 });
    const fake = fakeOpener();
    await startListening({
      machineId: machine.id,
      source: "manual",
      startedBy: "uji",
      open: fake.open,
    });

    expect(await stopListening(machine.ip)).toBe(true);
    expect(fake.stopped).toBe(1);
    expect(activeListens().map((s) => s.ip)).not.toContain(machine.ip);
    // Stopping twice is not an error — the caller wanted it stopped.
    expect(await stopListening(machine.ip)).toBe(false);
  });
});

describe("a scheduled window", () => {
  /* The window hears every booth there is, which is right in production and
     means these tests must each be the only booths in the table. */
  beforeEach(async () => {
    if (made.machines.length)
      await db
        .delete(schema.fingerprintMachines)
        .where(inArray(schema.fingerprintMachines.id, made.machines));
    made.machines = [];
  });

  test("opens the booths, and closes them when the window ends", async () => {
    const booth = await addMachine({ last: 71, booth: true });
    /* Universe-only but not a booth: monitored, not listened to. */
    await addMachine({ last: 72, booth: false });
    const fake = fakeOpener();

    const result = await runListenWindow(new Date(Date.now() + 40), {
      open: fake.open,
      everyMs: 20,
    });

    expect(result.opened).toBe(1);
    expect(result.failed).toBe(0);
    expect(fake.stopped).toBe(1);
    expect(activeListens().map((s) => s.ip)).not.toContain(booth.ip);
  });

  /*
   * One machine refusing must never end a muster's listening. This codebase
   * has made that mistake once already, in the collection pass.
   */
  test("a machine that refuses is counted, and the rest are still heard", async () => {
    const bad = await addMachine({ last: 73, booth: true });
    await addMachine({ last: 74, booth: true });
    let calls = 0;
    const opener: OpenLive = async ({ ip }) => {
      calls += 1;
      if (ip === bad.ip) throw new Error("mesin ini menolak");
      return { ip, stop: async () => {} };
    };

    const result = await runListenWindow(new Date(Date.now() + 40), {
      open: opener,
      everyMs: 20,
    });

    expect(calls).toBeGreaterThanOrEqual(2);
    expect(result.opened).toBe(1);
    /* Counted per attempt, not per machine: a booth that refuses twice refused
       twice, and a window that hid the second one would read as healthier than
       it was. */
    expect(result.failed).toBeGreaterThanOrEqual(1);
  });

  /* The window reconciles rather than reacts, which is what makes a reconnect
     free: a booth that dropped is simply missing at the next check. */
  test("a booth that dropped is opened again on the next check", async () => {
    await addMachine({ last: 75, booth: true });
    let attempts = 0;
    const opener: OpenLive = async ({ ip }) => {
      attempts += 1;
      if (attempts === 1) throw new Error("jaringan sedang putus");
      return { ip, stop: async () => {} };
    };

    const result = await runListenWindow(new Date(Date.now() + 120), {
      open: opener,
      everyMs: 30,
    });

    expect(attempts).toBeGreaterThan(1);
    expect(result.opened).toBe(1);
  });

  /* Somebody asked for it by hand; the schedule does not get to close it. */
  test("a manual session survives the window closing", async () => {
    const booth = await addMachine({ last: 76, booth: true });
    const fake = fakeOpener();
    await startListening({
      machineId: booth.id,
      source: "manual",
      startedBy: "Budi",
      open: fake.open,
    });

    await runListenWindow(new Date(Date.now() + 40), {
      open: fake.open,
      everyMs: 20,
    });

    expect(activeListens().map((s) => s.ip)).toContain(booth.ip);
    expect(fake.stopped).toBe(0);
  });
});
