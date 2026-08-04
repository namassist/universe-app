/**
 * The NIK join key between this system and the external sources.
 *
 * savera and Nakula disagree with each other about formatting — prefixes
 * (`KBE-UDU-…`), leading zeros, stray separators — while our `employees.nik`
 * stores the plain number. This recipe (digits only, then strip leading zeros)
 * is lifted from savera's own attendance sync, which has matched Nakula rows
 * to people in production with it; inventing a second recipe here would make
 * the two systems disagree about who is who.
 */
export function normalizeNik(value: string | null | undefined): string {
  const digits = (value ?? "").replace(/\D+/g, "");
  const stripped = digits.replace(/^0+/, "");
  // "0000" is a strange NIK, but it is a different fact than "no NIK": the
  // fallback keeps it from normalizing into the empty string.
  return stripped === "" ? digits : stripped;
}
