import { describe, expect, test } from "bun:test";

import { notifText } from "./notifications-data";

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
