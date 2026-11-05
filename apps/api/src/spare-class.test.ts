import { describe, expect, test } from "bun:test";

import { classIn, UNRANKED, type SimperClasses } from "./spare-class";

const classes: SimperClasses = new Map([
  [
    "e-1",
    new Map<string | null, number>([
      ["t-exc", 2],
      ["t-dt", 9],
    ]),
  ],
]);

describe("classIn", () => {
  test("reads the class in the asked unit type", () => {
    expect(classIn(classes, "e-1", "t-exc")).toBe(2);
    expect(classIn(classes, "e-1", "t-dt")).toBe(9);
  });

  test("a type the person holds no ranked code in is unranked", () => {
    expect(classIn(classes, "e-1", "t-dozer")).toBe(UNRANKED);
    expect(classIn(classes, "e-1", null)).toBe(UNRANKED);
  });

  test("somebody with no ranked code at all is unranked", () => {
    expect(classIn(classes, "e-2", "t-exc")).toBe(UNRANKED);
  });

  test("unranked sorts after every real rank", () => {
    expect(UNRANKED).toBeGreaterThan(1_000_000);
  });
});
