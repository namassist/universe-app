/**
 * The roster source's envelope, pinned.
 *
 * This path had never been exercised. `syncRoster` takes an injectable
 * fetcher and every other suite injects a fake, so nothing ever reached
 * `token()` — which read the JWT out of `data` for as long as it existed. The
 * source puts it in `token`, and only on that endpoint; `data_roster` really
 * does answer `data`. The mistake surfaced as a scheduler stack trace against
 * the live source rather than as a failing test.
 *
 * So these stub `fetch` instead of calling the source. What is worth holding
 * is the shape we agree to read, and a live call cannot pin that — it passes
 * or fails on whatever the source happens to be serving that hour.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";

import { fetchRosterRows } from "./unggul";

const realFetch = globalThis.fetch;

type Seen = { url: string; headers: Record<string, string> };
let seen: Seen[] = [];

/** Answers each endpoint from `bodies`, keyed by the tail of the path. */
function stub(bodies: Record<string, unknown>): void {
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = String(input);
    seen.push({
      url,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const key = Object.keys(bodies).find((k) => url.endsWith(k));
    return new Response(JSON.stringify(key ? bodies[key] : {}), {
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

const TOKEN_OK = {
  message: "Token diperbarui!",
  status: 200,
  token: "jwt-header.jwt-body.jwt-sig",
};

beforeEach(() => {
  seen = [];
});

afterAll(() => {
  globalThis.fetch = realFetch;
});

describe("fetchRosterRows", () => {
  test("reads the JWT from `token`, and sends it bare", async () => {
    stub({
      "/attendance/getToken": TOKEN_OK,
      "/attendance/data_roster": { message: "Data ditemukan", data: [] },
    });

    await fetchRosterRows("2026-09-01", "2026-09-02");

    const roster = seen.find((s) => s.url.endsWith("/attendance/data_roster"));
    /* Bare, not `Bearer <token>` — the source rejects the prefixed form, and
       nothing downstream would say so any louder than an empty pull. */
    expect(roster?.headers.Authorization).toBe(TOKEN_OK.token);
  });

  test("refuses a response that carries no token, and names what did arrive", async () => {
    /* The regression, exactly: the token under `data` is the shape this file
       used to read, and it must now fail rather than quietly work again. */
    stub({
      "/attendance/getToken": { message: "Token diperbarui!", data: "jwt" },
    });

    /* The fields are in the message because "returned no token" alone sent
       the last envelope change to a probe script to diagnose. */
    expect(fetchRosterRows("2026-09-01", "2026-09-02")).rejects.toThrow(
      /no token \(fields: message, data\)/
    );
  });

  test("folds the wide response into one row per person and day", async () => {
    stub({
      "/attendance/getToken": TOKEN_OK,
      "/attendance/data_roster": {
        message: "Data ditemukan",
        data: [
          {
            no_nik: "508242472",
            nama_lengkap: "Seseorang",
            departemen: "PIT SERVICE & DEVELOPMENT",
            posisi: "OPERATOR",
            tipe: "NON STAFF",
            "2026-09-01": "D",
            /* A day the source says nothing about — not the same as a day it
               says is unknown, and only the latter is worth a row. */
            "2026-09-02": "",
            /* A sixth fixed field, should the source ever add one: it is not
               a date, so it is not a roster code. */
            catatan: "cuti tahunan",
          },
        ],
      },
    });

    const rows = await fetchRosterRows("2026-09-01", "2026-09-02");

    expect(rows).toEqual([{ nik: "508242472", date: "2026-09-01", code: "D" }]);
  });

  test("treats a range the source has nothing for as an empty pull", async () => {
    /* A message and no `data` is how the source says "no rows", and it is not
       a failure — the scheduler must not log a stack trace for a quiet day. */
    stub({
      "/attendance/getToken": TOKEN_OK,
      "/attendance/data_roster": { message: "Data tidak ditemukan" },
    });

    expect(await fetchRosterRows("2026-09-01", "2026-09-02")).toEqual([]);
  });
});
