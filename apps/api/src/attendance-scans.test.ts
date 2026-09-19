/**
 * The attendance wall's scan feed, decided without a database or a clock.
 *
 * Everything worth being wrong about is here: that a tap both sources saw is
 * one ticket, the order tickets arrive in, and what the slip said about a
 * seat. The route only fetches.
 *
 *   bun --env-file=.env test src/attendance-scans.test.ts
 */

import { describe, expect, test } from "bun:test";

import { latestScans, mergeScans, slipSeat } from "./attendance-scans";

const D = "1998-03-01";
const seen = (hms: string) => new Date(`${D}T${hms}Z`);
const sighting = (
  nik: string,
  at: string,
  seenAt: string,
  ip = "10.0.0.1"
) => ({ ip, nik, at: `${D} ${at}`, seenAt: seen(seenAt) });

describe("merging the two sources", () => {
  test("a tap the live session and the pull both saw is one scan", () => {
    const merged = mergeScans(
      [sighting("1", "05:10:00", "05:10:01")],
      [sighting("1", "05:10:00", "05:11:30")]
    );
    expect(merged).toHaveLength(1);
    // First seen wins: the live session had it ninety seconds before the pull.
    expect(merged[0]!.seenAt).toEqual(seen("05:10:01"));
  });

  test("the same person on two machines is two scans", () => {
    const merged = mergeScans(
      [sighting("1", "05:10:00", "05:10:01", "10.0.0.1")],
      [sighting("1", "05:10:00", "05:11:30", "10.0.0.2")]
    );
    expect(merged).toHaveLength(2);
  });

  test("scans are in the order we learned of them, not the machine's clock", () => {
    /* A machine's clock can be minutes out, and a pulled batch arrives long
       after the live one. The wall plays scans as they reach us. */
    const merged = mergeScans(
      [sighting("2", "05:12:00", "05:12:01")],
      [sighting("1", "05:09:00", "05:13:00")]
    );
    expect(merged.map((s) => s.nik)).toEqual(["2", "1"]);
  });

  test("a whole pulled batch shares one moment and still has one order", () => {
    const merged = mergeScans(
      [],
      [
        sighting("3", "05:10:00", "05:11:00"),
        sighting("1", "05:10:00", "05:11:00"),
        sighting("2", "05:10:00", "05:11:00"),
      ]
    );
    // Tied on arrival, so the key decides — stable across polls.
    expect(merged.map((s) => s.nik)).toEqual(["1", "2", "3"]);
    expect(new Set(merged.map((s) => s.key)).size).toBe(3);
  });
});

describe("what goes on the wire", () => {
  test("only the latest scans, oldest of them first", () => {
    const merged = mergeScans(
      [],
      Array.from({ length: 5 }, (_, i) =>
        sighting(String(i), "05:10:00", `05:1${i}:00`)
      )
    );
    expect(latestScans(merged, 3).map((s) => s.nik)).toEqual(["2", "3", "4"]);
  });
});

describe("the direction on a ticket", () => {
  test("a pulled tap's direction survives the live sighting winning", () => {
    /* The live session saw it first but knows no direction; the pull does. */
    const merged = mergeScans(
      [sighting("1", "05:10:00", "05:10:01")],
      [{ ...sighting("1", "05:10:00", "05:11:30"), direction: "out" as const }]
    );
    expect(merged[0]!.direction).toBe("out");
  });

  test("a scan only the live session saw has no direction of its own", () => {
    const merged = mergeScans([sighting("1", "05:10:00", "05:10:01")], []);
    expect(merged[0]!.direction).toBeUndefined();
  });
});

describe("what the slip said about the seat", () => {
  test("a seat reads as its unit, area and bus", () => {
    expect(
      slipSeat({
        seat: { unit: "RD5061", bus: "UD BU 04", fleet: null, area: "KU2" },
      })
    ).toEqual({ unit: "RD5061", area: "KU2", bus: "UD BU 04" });
  });

  test("a spare reads SPARE, with the spare bus and where it waits", () => {
    expect(
      slipSeat({
        seat: null,
        withoutUnit: "spare",
        spareRide: { buses: ["BU 01", "BU 02"], area: "POOL" },
      })
    ).toEqual({ unit: "SPARE", area: "POOL", bus: "BU 01, BU 02" });
  });

  test("somebody the board never considers reads dashes, as the slip does", () => {
    expect(slipSeat({ seat: null })).toEqual({
      unit: "-",
      area: null,
      bus: null,
    });
  });

  test("no slip at all is not the same as a slip saying no unit", () => {
    expect(slipSeat(null)).toBeNull();
  });
});
