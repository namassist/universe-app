import { describe, expect, test } from "bun:test";

import { inDialogView, simperBadges } from "./alloc-dialog";

describe("simperBadges", () => {
  test("the unit's code leads and is marked; the rest keep their order", () => {
    expect(
      simperBadges(["DT 465", "EXC 2600", "OHT 777"], "OHT 777", 6)
    ).toEqual({
      shown: [
        { name: "OHT 777", match: true },
        { name: "DT 465", match: false },
        { name: "EXC 2600", match: false },
      ],
      more: 0,
    });
  });

  test("a code the unit does not ask for is never marked", () => {
    expect(simperBadges(["DT 465"], "OHT 777", 6)).toEqual({
      shown: [{ name: "DT 465", match: false }],
      more: 0,
    });
    expect(simperBadges(["DT 465"], null, 6).shown[0]?.match).toBe(false);
  });

  test("past the cap the rest are counted, the unit's code still shown", () => {
    const codes = ["A", "B", "C", "D", "E", "F", "G", "Z"];
    const { shown, more } = simperBadges(codes, "Z", 6);
    expect(shown.map((c) => c.name)).toEqual(["Z", "A", "B", "C", "D", "E"]);
    expect(more).toBe(2);
  });

  test("an operator with no codes shows none", () => {
    expect(simperBadges([], "OHT 777", 6)).toEqual({ shown: [], more: 0 });
  });
});

describe("inDialogView", () => {
  const row = (eligible: boolean, onShift: boolean) => ({ eligible, onShift });

  test("eligible keeps the eligible who are rostered to the shift now", () => {
    expect(inDialogView(row(true, true), "eligible", true)).toBe(true);
    expect(inDialogView(row(true, false), "eligible", true)).toBe(false);
    expect(inDialogView(row(false, true), "eligible", true)).toBe(false);
  });

  test("an undecided timeline filters on eligibility alone", () => {
    expect(inDialogView(row(true, false), "eligible", false)).toBe(true);
    expect(inDialogView(row(false, false), "eligible", false)).toBe(false);
  });

  test("all shows everybody", () => {
    expect(inDialogView(row(false, false), "all", true)).toBe(true);
  });
});
