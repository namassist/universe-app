/**
 * What a kiosk is told to play, and when.
 *
 * The screens have the speakers and the server has the clock, so the cue
 * travels on the poll every display already makes. Pinned here: only a screen
 * switched on for sound is given one, and a silent stage produces none.
 *
 * Needs the dev Postgres and Redis:
 *   bun --env-file=.env test src/routes/display-cue.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { inArray } from "drizzle-orm";

import { createSession, DEVICE_COOKIE } from "../auth/session";
import { db, schema } from "../db";
import { redis } from "../redis";
import { SOUND_LEAD_SECONDS } from "../sound-cue";
import { displayRoutes } from "./devices";
import { soundsRoutes } from "./display-content";

const app = new Elysia().use(displayRoutes).use(soundsRoutes);

const uid = () => crypto.randomUUID().slice(0, 8);
const tag = `ZZ Uji Cue ${uid()}`;

const made = {
  devices: [] as string[],
  stages: [] as string[],
  sounds: [] as string[],
};

let soundId = "";
let loud: string = "";
let quiet: string = "";

type Cue = {
  id: string;
  soundId: string;
  stageName: string;
  playAt: string;
} | null;

const pad = (n: number) => String(n).padStart(2, "0");

/** A stage due far enough ahead that its cue is inside the horizon. */
function soonAt(minutesAhead: number) {
  const at = new Date(Date.now() + minutesAhead * 60_000);
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

async function makeDevice(sound: boolean) {
  const id = `ZZC${uid().toUpperCase()}`;
  await db
    .insert(schema.devices)
    .values({ id, name: tag, kind: "fitwork", sound });
  made.devices.push(id);
  const session = await createSession("device", id, "cookie");
  return `${DEVICE_COOKIE}=${session.id}`;
}

async function stage(at: string, withSound: boolean) {
  const [row] = await db
    .insert(schema.timelineStages)
    .values({
      name: `${tag} ${uid()}`,
      at: `${at}:00`,
      action: "other",
      soundId: withSound ? soundId : null,
    })
    .returning({ id: schema.timelineStages.id });
  made.stages.push(row!.id);
  return row!.id;
}

const cueOf = async (cookie: string): Promise<Cue> => {
  const response = await app.handle(
    new Request("http://localhost/display/fitwork", { headers: { cookie } })
  );
  expect(response.status).toBe(200);
  return ((await response.json()) as { cue: Cue }).cue;
};

beforeAll(async () => {
  if (redis.status === "end") await redis.connect();
  const [sound] = await db
    .insert(schema.sounds)
    .values({
      name: `${tag} bunyi`,
      fileName: `${uid()}.mp3`,
      mimeType: "audio/mpeg",
      sizeBytes: 1,
    })
    .returning({ id: schema.sounds.id });
  soundId = sound!.id;
  made.sounds.push(sound!.id);

  loud = await makeDevice(true);
  quiet = await makeDevice(false);
});

afterAll(async () => {
  if (made.stages.length)
    await db
      .delete(schema.timelineStages)
      .where(inArray(schema.timelineStages.id, made.stages));
  if (made.sounds.length)
    await db
      .delete(schema.sounds)
      .where(inArray(schema.sounds.id, made.sounds));
  if (made.devices.length)
    await db
      .delete(schema.devices)
      .where(inArray(schema.devices.id, made.devices));
});

describe("the cue a screen is given with its content", () => {
  test("names the sound and the instant, two minutes before the stage", async () => {
    const at = soonAt(6);
    const id = await stage(at, true);

    const cue = await cueOf(loud);
    expect(cue).toMatchObject({ soundId });
    expect(cue!.id).toContain(id);

    // Two minutes before the stage, to the second.
    const [hours, minutes] = at.split(":").map(Number);
    const due = new Date();
    due.setHours(hours!, minutes!, 0, 0);
    expect(new Date(cue!.playAt).getTime()).toBe(
      due.getTime() - SOUND_LEAD_SECONDS * 1000
    );
  });

  test("a screen with sound switched off is given none", async () => {
    await stage(soonAt(7), true);
    expect(await cueOf(quiet)).toBeNull();
  });

  test("the screen may fetch the bytes it was cued to play", async () => {
    /* A television holds no menu permission; without this it would be told
       to play a sound it is then refused. 404 here means the row exists and
       the file does not, which is the storage volume's business, not auth's. */
    const response = await app.handle(
      new Request(`http://localhost/sounds/${soundId}/file`, {
        headers: { cookie: loud },
      })
    );
    expect([200, 404]).toContain(response.status);
  });

  test("a silent stage is no cue at all", async () => {
    // Every stage on the wall today has no sound; none of them may sound.
    await db
      .delete(schema.timelineStages)
      .where(inArray(schema.timelineStages.id, made.stages));
    made.stages.length = 0;
    await stage(soonAt(5), false);
    expect(await cueOf(loud)).toBeNull();
  });
});
