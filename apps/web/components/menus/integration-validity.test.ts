import { describe, expect, test } from "bun:test";

import {
  addYears,
  defaultValidity,
  validityBody,
  validityProblem,
  validityState,
} from "./integration-validity";

const TODAY = "2026-10-09";

describe("validityState", () => {
  test("a token with no end and a start already reached never expires", () => {
    expect(validityState("2026-10-09", null, TODAY)).toEqual({
      kind: "never",
    });
  });

  test("well before its end it is simply valid", () => {
    expect(validityState("2026-10-01", "2026-12-08", TODAY)).toEqual({
      kind: "valid",
      daysLeft: 60,
    });
  });

  test("two weeks or less before the end is flagged", () => {
    expect(validityState("2026-10-01", "2026-10-23", TODAY)).toEqual({
      kind: "soon",
      daysLeft: 14,
    });
  });

  test("its last day is still a day left — the end is inclusive", () => {
    expect(validityState("2026-10-01", "2026-10-09", TODAY)).toEqual({
      kind: "soon",
      daysLeft: 0,
    });
  });

  test("the day after the end is expired", () => {
    expect(validityState("2026-09-01", "2026-10-08", TODAY)).toEqual({
      kind: "expired",
    });
  });

  test("before the start it is scheduled, whatever the end", () => {
    expect(validityState("2026-10-12", "2027-10-12", TODAY)).toEqual({
      kind: "scheduled",
      startsIn: 3,
    });
    expect(validityState("2026-10-12", null, TODAY)).toEqual({
      kind: "scheduled",
      startsIn: 3,
    });
  });
});

describe("addYears", () => {
  test("moves the date a year on", () => {
    expect(addYears("2026-10-09", 1)).toBe("2027-10-09");
  });

  test("29 February lands on the last day of February", () => {
    expect(addYears("2028-02-29", 1)).toBe("2029-02-28");
  });
});

describe("the form's dates", () => {
  test("start today and end a year on, by default", () => {
    expect(defaultValidity(TODAY)).toEqual({
      validFrom: "2026-10-09",
      validUntil: "2027-10-09",
      noEnd: false,
    });
  });

  test("no end sends null, whatever the end field still holds", () => {
    expect(
      validityBody({
        validFrom: TODAY,
        validUntil: "2027-10-09",
        noEnd: true,
      })
    ).toEqual({ validFrom: TODAY, validUntil: null });
  });

  test("an end before the start, or already past, is a problem", () => {
    const base = { validFrom: TODAY, noEnd: false };
    expect(validityProblem({ ...base, validUntil: "2026-10-01" }, TODAY)).toBe(
      "Tanggal akhir tidak boleh sebelum tanggal mulai"
    );
    expect(
      validityProblem(
        { validFrom: "2026-09-01", validUntil: "2026-10-08", noEnd: false },
        TODAY
      )
    ).toBe("Tanggal akhir sudah lewat");
    expect(validityProblem({ ...base, validUntil: "" }, TODAY)).toBe(
      "Isi tanggal akhir, atau centang Tanpa batas"
    );
    expect(validityProblem({ ...base, validUntil: "2027-10-09" }, TODAY)).toBe(
      null
    );
    expect(
      validityProblem({ ...base, validUntil: "", noEnd: true }, TODAY)
    ).toBe(null);
  });

  test("a start is always needed", () => {
    expect(
      validityProblem({ validFrom: "", validUntil: "", noEnd: true }, TODAY)
    ).toBe("Isi tanggal mulai");
  });
});
