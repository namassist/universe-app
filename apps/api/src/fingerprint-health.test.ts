/**
 * Is this booth ready for a muster — can a tap here become a slip?
 *
 * A machine that answers but whose printer does not is the case this exists
 * for: the tap is recorded, the slip never comes out, and every screen used to
 * call the machine "online" (2026-10-10).
 */

import { describe, expect, test } from "bun:test";

import { boothHealth } from "./fingerprint-health";

const seen = new Date();
const machineUp = { online: true, checkedAt: seen };
const machineDown = { online: false, checkedAt: seen };
const up = { active: true, online: true, checkedAt: seen };
const down = { active: true, online: false, checkedAt: seen };

describe("a booth's health", () => {
  test("a machine that does not answer is offline, whatever its printer does", () => {
    expect(boothHealth(machineDown, up)).toBe("offline");
    expect(boothHealth(machineDown, null)).toBe("offline");
  });

  test("a machine with no printer paired cannot hand out a slip", () => {
    expect(boothHealth(machineUp, null)).toBe("no_printer");
  });

  test("a printer switched off in the registry is never printed to", () => {
    expect(boothHealth(machineUp, { ...up, active: false })).toBe(
      "printer_inactive"
    );
  });

  test("a printer that does not answer is a problem even when the machine is fine", () => {
    expect(boothHealth(machineUp, down)).toBe("printer_offline");
  });

  test("ready only when the machine and its printer both answer", () => {
    expect(boothHealth(machineUp, up)).toBe("ready");
  });

  /* A device's `online` starts false, so before its first probe it would read
     as dead. Right after a machine was switched on, every printer beside it
     said "Printer mati" for up to a cycle (2026-10-10) — not yet asked is not
     the same as asked and silent. */
  test("a machine never probed is unchecked, not offline", () => {
    expect(boothHealth({ online: false, checkedAt: null }, up)).toBe(
      "unchecked"
    );
  });

  test("a printer never probed is unchecked, not dead", () => {
    expect(
      boothHealth(machineUp, { active: true, online: false, checkedAt: null })
    ).toBe("unchecked");
  });
});
