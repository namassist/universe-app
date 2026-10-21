import { describe, expect, test } from "bun:test";

import { notifText, notifTime } from "./notifications-data";

/* The test slip sent to every booth printer when the first finger opens
   (owner, 2026-10-10). The notice must name the booths to go and look at. */
describe("the printer test notice", () => {
  test("all sent says how many, for which shift", () => {
    const text = notifText(
      {
        kind: "printer-test",
        params: { shift: "night", total: 25, sent: 25, failed: [] },
      },
      "id"
    );
    expect(text).toContain("25/25");
    expect(text).toContain("malam");
  });

  test("a failure names every booth it failed at", () => {
    const text = notifText(
      {
        kind: "printer-test",
        params: {
          shift: "day",
          total: 25,
          sent: 23,
          failed: ["Mesin 12 KM 31", "Mesin 14 KM 31"],
        },
      },
      "id"
    );
    expect(text).toContain("23/25");
    expect(text).toContain("Mesin 12 KM 31");
    expect(text).toContain("Mesin 14 KM 31");
  });

  test("reads in English too", () => {
    const text = notifText(
      {
        kind: "printer-test",
        params: { shift: "day", total: 3, sent: 2, failed: ["Mesin 20 KM 31"] },
      },
      "en"
    );
    expect(text).toContain("2/3");
    expect(text).toContain("Mesin 20 KM 31");
  });
});

/* The whole sentence of every notice, in both languages, pinned as it read
   before the wording moved into the dictionaries. */
describe("every notice reads word for word", () => {
  const gen = {
    kind: "allocation-generated",
    params: { shift: "day", date: "2026-10-21", crewed: 40, units: 42 },
  };
  const fail = (reason: string) => ({
    kind: "allocation-failed",
    params: { shift: "night", date: "2026-10-21", reason },
  });
  const slip = (failed: string[]) => ({
    kind: "printer-test",
    params: { shift: "night", total: 3, sent: 2, failed },
  });

  test.each([
    [
      gen,
      "id",
      "Papan shift pagi 2026-10-21 selesai digenerate — 40 dari 42 unit dapat operator",
    ],
    [gen, "en", "day board for 2026-10-21 generated — 40 of 42 units crewed"],
    [
      fail("no-shift"),
      "id",
      "Generate papan shift malam 2026-10-21 gagal — stage timeline ini belum diberi shift",
    ],
    [
      fail("no-finger-deadline"),
      "id",
      "Generate papan shift malam 2026-10-21 gagal — stage Batas Finger In tidak aktif",
    ],
    [
      fail("no-ftw-deadline"),
      "id",
      "Generate papan shift malam 2026-10-21 gagal — stage Batas Upload FTW tidak aktif",
    ],
    [
      fail("unexpected"),
      "id",
      "Generate papan shift malam 2026-10-21 gagal — kesalahan tak terduga — cek log server",
    ],
    [
      fail("no-shift"),
      "en",
      "night board for 2026-10-21 failed to generate — the timeline stage has no shift set",
    ],
    [
      fail("no-finger-deadline"),
      "en",
      "night board for 2026-10-21 failed to generate — no active finger-in stage",
    ],
    [
      fail("no-ftw-deadline"),
      "en",
      "night board for 2026-10-21 failed to generate — no active FTW upload deadline",
    ],
    [
      fail("unexpected"),
      "en",
      "night board for 2026-10-21 failed to generate — unexpected error — check the server log",
    ],
    [
      fail("something new"),
      "id",
      "Generate papan shift malam 2026-10-21 gagal — something new",
    ],
    [
      slip([]),
      "id",
      "Tes printer shift malam: 2/3 terkirim — cek slip keluar di tiap bilik",
    ],
    [
      slip(["A", "B"]),
      "id",
      "Tes printer shift malam: 2/3 terkirim — gagal: A, B",
    ],
    [
      slip([]),
      "en",
      "night printer test: 2/3 sent — check each booth printed its slip",
    ],
    [slip(["A", "B"]), "en", "night printer test: 2/3 sent — failed: A, B"],
    [{ kind: "brand-new-kind", params: {} }, "id", "brand-new-kind"],
    [
      { kind: "allocation-generated", params: { shift: "swing" } },
      "en",
      "swing board for  generated — 0 of 0 units crewed",
    ],
  ] as const)("%o in %s", (n, lang, text) => {
    expect(notifText(n, lang)).toBe(text);
  });
});

describe("how long ago a notice came", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const ago = (ms: number) => new Date(now - ms).toISOString();
  const MIN = 60_000;

  test.each([
    [10_000, "Baru saja", "Just now"],
    [MIN, "1 menit lalu", "1 minute ago"],
    [5 * MIN, "5 menit lalu", "5 minutes ago"],
    [60 * MIN, "1 jam lalu", "1 hour ago"],
    [3 * 60 * MIN, "3 jam lalu", "3 hours ago"],
    [24 * 60 * MIN, "Kemarin", "Yesterday"],
    [3 * 24 * 60 * MIN, "3 hari lalu", "3 days ago"],
  ])("%d ms", (ms, idText, enText) => {
    expect(notifTime(ago(ms), "id", now)).toBe(idText);
    expect(notifTime(ago(ms), "en", now)).toBe(enText);
  });
});
