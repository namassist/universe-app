import { describe, expect, test } from "bun:test";

import { fmt } from "./fmt";

describe("fmt", () => {
  test("fills every named slot, in whatever order the sentence wants them", () => {
    expect(fmt("{a} dari {b} yang perlu dilihat", { a: 3, b: "25" })).toBe(
      "3 dari 25 yang perlu dilihat"
    );
    expect(fmt("{b} need a look, {a} of them", { a: 3, b: 25 })).toBe(
      "25 need a look, 3 of them"
    );
  });

  test("fills a slot used twice both times", () => {
    expect(fmt("{n}/{n}", { n: 4 })).toBe("4/4");
  });

  test("leaves a slot it was not given as written, so a missing value shows", () => {
    expect(fmt("Shift {shift}", {})).toBe("Shift {shift}");
  });

  test("a sentence without slots comes back unchanged", () => {
    expect(fmt("Baru saja", { n: 1 })).toBe("Baru saja");
  });
});
