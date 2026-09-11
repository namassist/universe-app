/**
 * That a request to a machine cannot happen without being written down.
 *
 * This is the evidence half of the promise. The other half — that no command
 * we send can delete anything — is pinned by `fingerprint.readonly.test.ts`.
 * Together they answer "what did you do to this machine at 11:42" with a list
 * rather than an assurance.
 *
 * The failure path matters as much as the success one: an incident morning is
 * exactly when machines stop answering, and a record that goes quiet when
 * things go wrong is worth nothing.
 *
 * Needs the dev Postgres:
 *   bun --env-file=.env test src/sources/fingerprint-log.test.ts
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { desc, eq } from "drizzle-orm";

import { db, schema } from "../db";
import { fetchAttLog, fetchLogCount } from "./fingerprint";

/** An address in the documentation range: nothing can answer, always. */
const NOWHERE = "192.0.2.1";

const rowsFor = (ip: string) =>
  db
    .select()
    .from(schema.deviceRequests)
    .where(eq(schema.deviceRequests.ip, ip))
    .orderBy(desc(schema.deviceRequests.at));

beforeEach(async () => {
  await db
    .delete(schema.deviceRequests)
    .where(eq(schema.deviceRequests.ip, NOWHERE));
});

afterAll(async () => {
  await db
    .delete(schema.deviceRequests)
    .where(eq(schema.deviceRequests.ip, NOWHERE));
});

describe("a machine that cannot be reached", () => {
  test("an attendance pull is still written down, marked failed", async () => {
    const taps = await fetchAttLog(NOWHERE, 0, 1500);

    expect(taps).toEqual([]);
    const rows = await rowsFor(NOWHERE);
    const pull = rows.find((r) => r.command === "GetAttLog");
    expect(pull).toBeDefined();
    expect(pull!.ok).toBe(false);
  });

  test("a count is too, and answers null rather than throwing", async () => {
    const count = await fetchLogCount(NOWHERE, 1500);

    expect(count).toBeNull();
    const rows = await rowsFor(NOWHERE);
    expect(rows.some((r) => r.command === "GetInfo" && !r.ok)).toBe(true);
  });

  /* The note is read during an incident by somebody deciding who to ask, so it
     has to be short and safe to show — a reason, never a whole error, which on
     a fetch failure carries the address and can carry more. */
  test("the note says why without quoting the error", async () => {
    await fetchAttLog(NOWHERE, 0, 1500);

    const note = (await rowsFor(NOWHERE))[0]!.note ?? "";
    expect(note.length).toBeGreaterThan(0);
    expect(note.length).toBeLessThan(60);
    expect(note).not.toContain("192.0.2.1");
  });
});

describe("what the record can ever say", () => {
  /* Belt and braces with the readonly test: that one proves no write command
     is written in the client, this one proves none has ever reached the table.
     If a machine is ever emptied, this query is the answer. */
  test("no write command appears in the log, ever", async () => {
    const rows = await db
      .select({ command: schema.deviceRequests.command })
      .from(schema.deviceRequests);
    const seen = new Set(rows.map((r) => r.command));
    for (const command of seen)
      expect(["GetAttLog", "GetInfo"]).toContain(command);
  });
});
