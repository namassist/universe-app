/**
 * One IPv4 host address, and the refusal that names it.
 *
 * Shared by the fingerprint machine and printer registries: both identify a
 * device by its address, and two copies of this rule would drift the day one
 * of them learns about IPv6 or a hostname.
 *
 * Checked in the handler rather than as a TypeBox `pattern`, because
 * validation runs before the handler can trim, and an address pasted from a
 * spreadsheet arrives padded. Refusing that would be a rule about whitespace
 * rather than about addresses.
 */
export const IPV4 =
  /^((25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d{2}|[1-9]?\d)$/;

export const invalidIp = (ip: string) => ({
  code: "validation_failed",
  message: `"${ip}" bukan alamat IPv4 yang sah`,
});
