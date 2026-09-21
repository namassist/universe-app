/**
 * What a scanned QR code means, before anything is fetched.
 *
 * Pure, so the rules that decide whether a reading is a card — and whether it
 * is a card we have already answered — are tested without a camera.
 */

/** Digits only, then leading zeros off: the recipe every source is matched by. */
function plainNik(value: string): string | null {
  const digits = value.replace(/\D+/g, "");
  if (!digits) return null;
  const stripped = digits.replace(/^0+/, "");
  // All zeros is a strange NIK but a different fact from "no NIK at all".
  return stripped || digits;
}

/**
 * The NIK a scanned code carries.
 *
 * A QR code holds as much as the card printer felt like putting in it, so the
 * number is looked for in the three shapes it comes in, most explicit first:
 *
 * 1. a JSON payload naming a `nik`,
 * 2. a link carrying it as a query parameter,
 * 3. the digits themselves — a bare number, or the last segment of a path.
 *
 * The order matters more than it looks. Reading digits out of a whole link
 * would fold a version, a port or a date into the number and resolve to
 * somebody else entirely; asking what the payload *calls* the NIK avoids
 * guessing. Only when nothing names it does the reading fall back to digits,
 * which is what a plain-number card carries.
 *
 * `null` when there is no number to be found — a poster, a parcel label, a QR
 * code pointing at a website.
 */
export function nikOfScan(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;

  if (text.startsWith("{")) {
    try {
      const payload = JSON.parse(text) as Record<string, unknown>;
      const named = Object.entries(payload).find(
        ([key]) => key.toLowerCase() === "nik"
      )?.[1];
      if (named !== undefined && named !== null) return plainNik(String(named));
    } catch {
      // Not JSON after all; fall through to the other shapes.
    }
  }

  if (/^https?:\/\//i.test(text)) {
    try {
      const url = new URL(text);
      for (const [key, value] of url.searchParams)
        if (key.toLowerCase() === "nik") return plainNik(value);
      // No parameter names it, so the last path segment is the candidate —
      // never the host or the query, which carry digits of their own.
      const last = url.pathname.split("/").filter(Boolean).at(-1);
      return last ? plainNik(last) : null;
    } catch {
      // A malformed link is read as plain text, like anything else.
    }
  }

  return plainNik(text);
}

/**
 * Whether a reading is worth a request.
 *
 * A camera reads the same card many times a second while it is held up, and
 * the answer cannot change between two of those readings. Only a different
 * card asks again — including the same card scanned afresh after the screen
 * has been cleared, which is why this compares against what is on screen
 * rather than against everything ever seen.
 */
export function shouldLookUp(nik: string, showing: string | null): boolean {
  return nik !== showing;
}
