/**
 * What a scanned QR code means, without a camera.
 *
 *   cd apps/web && bun test components/menus/scan-id-rules.test.ts
 */

import { describe, expect, test } from "bun:test";

import { nikOfScan, shouldLookUp } from "./scan-id-rules";

describe("reading a card's QR code", () => {
  test("the plain number is the NIK", () => {
    expect(nikOfScan("508253490")).toBe("508253490");
  });

  test("a printed prefix and leading zeros are not part of it", () => {
    /* The register holds the plain number; the cards are printed however the
       card printer was set up. Same recipe every other source is matched by. */
    expect(nikOfScan("KBE-UDU-000508253490")).toBe("508253490");
  });

  /* A QR code is big enough to hold a link, and card printers like putting
     one in. Everything after the number would otherwise be read as part of
     it — a version, a port, a date — and resolve to somebody else entirely. */
  test("a link is read by what it calls the NIK, not by its digits", () => {
    expect(nikOfScan("https://hr.udu.co.id/emp/x?nik=508253490&v=2")).toBe(
      "508253490"
    );
  });

  test("a JSON payload is read by its nik field", () => {
    expect(nikOfScan('{"nik":"508253490","name":"YOHANES"}')).toBe("508253490");
    expect(nikOfScan('{"NIK": 508253490}')).toBe("508253490");
  });

  test("a link with the number in its path is read from the path", () => {
    expect(nikOfScan("https://hr.udu.co.id/karyawan/508253490")).toBe(
      "508253490"
    );
  });

  test("a reading with no digits at all is not a card", () => {
    expect(nikOfScan("SCAN ME")).toBeNull();
    expect(nikOfScan("   ")).toBeNull();
    expect(nikOfScan("https://udu.co.id/")).toBeNull();
  });

  test("a stray space or newline from the reader is trimmed away", () => {
    expect(nikOfScan(" 508253490\n")).toBe("508253490");
  });
});

describe("when to ask the server", () => {
  test("a new card is looked up", () => {
    expect(shouldLookUp("508253490", null)).toBe(true);
  });

  /* A camera reads the same card many times a second while it is held up;
     one lookup is the whole of what the screen needs. */
  test("the card already on screen is not asked about again", () => {
    expect(shouldLookUp("508253490", "508253490")).toBe(false);
  });

  test("a different card replaces it at once", () => {
    expect(shouldLookUp("508253491", "508253490")).toBe(true);
  });
});
