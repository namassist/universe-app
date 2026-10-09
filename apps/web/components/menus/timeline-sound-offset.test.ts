import { describe, expect, test } from "bun:test";

import { soundTimeFor, stepSoundOffset } from "./timeline-sound-offset";

describe("stepSoundOffset", () => {
  test("moves one minute at a time", () => {
    expect(stepSoundOffset(-2, 1)).toBe(-1);
    expect(stepSoundOffset(-2, -1)).toBe(-3);
    expect(stepSoundOffset(0, 1)).toBe(1);
  });

  test("stops at five either way", () => {
    expect(stepSoundOffset(-5, -1)).toBe(-5);
    expect(stepSoundOffset(5, 1)).toBe(5);
  });
});

describe("soundTimeFor", () => {
  test("is the stage's time moved by the offset", () => {
    expect(soundTimeFor("05:21", -5)).toBe("05:16");
    expect(soundTimeFor("05:21", 0)).toBe("05:21");
    expect(soundTimeFor("05:30", 3)).toBe("05:33");
  });

  test("wraps across midnight both ways", () => {
    expect(soundTimeFor("00:02", -5)).toBe("23:57");
    expect(soundTimeFor("23:58", 5)).toBe("00:03");
  });

  test("is empty for a time the form does not hold yet", () => {
    expect(soundTimeFor("", -2)).toBe("");
  });
});
