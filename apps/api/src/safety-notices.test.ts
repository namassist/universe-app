/**
 * The wall and the slip read the same rows.
 *
 * What is proven here is the split and the caps — that a line nobody
 * classified stays off the paper, that eight locations is where the roll
 * stops, and that the ticker gets one sentence rather than eight fragments.
 *
 * Needs the dev Postgres:
 *   bun --env-file=.env test src/safety-notices.test.ts
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { inArray } from "drizzle-orm";

import { db, schema } from "./db";
import {
  activeNotices,
  hazardSentence,
  MAX_HAZARDS,
  MAX_SAFETY,
} from "./safety-notices";

const tag = `ZZ ${crypto.randomUUID().slice(0, 8)}`;
const made: string[] = [];
/** Everything already in the register, so the assertions read our rows only. */
let before: { hazards: string[]; safety: string[] };

const add = async (
  text: string,
  kind: "hazard" | "safety" | "general",
  active = true
) => {
  const [row] = await db
    .insert(schema.runTexts)
    .values({ text, color: "Cyan", kind, active })
    .returning({ id: schema.runTexts.id });
  made.push(row!.id);
};

beforeAll(async () => {
  before = await activeNotices();
  for (let i = 1; i <= MAX_HAZARDS + 2; i += 1)
    await add(`${tag} LOKASI ${i}`, "hazard");
  await add(`${tag} pesan satu`, "safety");
  await add(`${tag} pesan dua`, "safety");
  await add(`${tag} pesan tiga`, "safety");
  await add(`${tag} pesan empat`, "safety");
  await add(`${tag} pengumuman`, "general");
  await add(`${tag} lokasi mati`, "hazard", false);
});

afterAll(async () => {
  if (made.length)
    await db.delete(schema.runTexts).where(inArray(schema.runTexts.id, made));
});

const mine = (rows: string[], had: string[]) =>
  rows.filter((r) => !had.includes(r));

describe("what reaches the paper", () => {
  test("stops at eight locations however many are set", async () => {
    const { hazards } = await activeNotices();
    expect(hazards.length).toBeLessThanOrEqual(MAX_HAZARDS);
    expect(mine(hazards, before.hazards)).not.toContain(
      `${tag} LOKASI ${MAX_HAZARDS + 2}`
    );
  });

  /* Two since 2026-09-15, when they became the slip's closing lines. */
  test("stops at two safety lines", async () => {
    const { safety } = await activeNotices();
    expect(safety.length).toBeLessThanOrEqual(MAX_SAFETY);
    expect(MAX_SAFETY).toBe(2);
    expect(mine(safety, before.safety)).not.toContain(`${tag} pesan tiga`);
  });

  /* The ticker's own announcements have no business lengthening a roll. */
  test("a general line reaches neither section", async () => {
    const { hazards, safety } = await activeNotices();
    expect([...hazards, ...safety]).not.toContain(`${tag} pengumuman`);
  });

  test("an inactive location is not read at all", async () => {
    const { hazards } = await activeNotices();
    expect(hazards).not.toContain(`${tag} lokasi mati`);
  });
});

describe("the sentence the wall shows", () => {
  test("names what the list is, then joins it", () => {
    expect(hazardSentence(["PIT", "KASTURI ATAS"])).toBe(
      "Lokasi berbahaya: PIT, KASTURI ATAS"
    );
  });

  /* A heading with nothing after it would scroll past as a bare label. */
  test("is nothing at all when no location is set", () => {
    expect(hazardSentence([])).toBeNull();
  });
});
