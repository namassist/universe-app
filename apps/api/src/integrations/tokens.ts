/**
 * Integration tokens — minted once, stored as a hash, read off a bearer header.
 *
 * A token is 32 random bytes, so sha256 is enough to keep it: there is nothing
 * to brute-force that a slow password hash would protect, and a fast hash is
 * what lets authentication be one index probe on `token_hash` rather than a
 * scan comparing every client's argon2 in turn.
 */

import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { INTEGRATION_TOKEN_PREFIX } from "@universe/contracts";

const TOKEN_BYTES = 32;
/** Characters after the prefix kept for the screen — enough to tell apart. */
const SHOWN_CHARS = 6;
/** base64url of 32 bytes, unpadded. */
const TOKEN_BODY = /^[A-Za-z0-9_-]{43}$/;

export type MintedToken = {
  /** Shown to the admin once, never stored. */
  token: string;
  hash: string;
  prefix: string;
};

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function mintToken(): MintedToken {
  const token =
    INTEGRATION_TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString("base64url");
  return {
    token,
    hash: hashToken(token),
    prefix: token.slice(0, INTEGRATION_TOKEN_PREFIX.length + SHOWN_CHARS),
  };
}

/**
 * The token in an `Authorization: Bearer …` header, or null when the header
 * carries anything else — a user's bearer session id included, which is what
 * keeps the two kinds of caller from ever being mistaken for one another.
 */
export function presentedToken(header: string | undefined): string | null {
  if (!header?.startsWith("Bearer ")) return null;
  const value = header.slice("Bearer ".length).trim();
  if (!value.startsWith(INTEGRATION_TOKEN_PREFIX)) return null;
  const body = value.slice(INTEGRATION_TOKEN_PREFIX.length);
  return TOKEN_BODY.test(body) ? value : null;
}

const MAPPED = "::ffff:";

/**
 * One spelling per address, or null for something that is not one.
 *
 * Compared as strings, `0:0:0:0:0:0:0:1` is not `::1`, and a dual-stack
 * socket reports an IPv4 peer as `::ffff:192.168.1.5` — or `::ffff:c0a8:105`
 * once canonicalised — so both the saved entry and the caller's address go
 * through here before they meet. IPv6 is canonicalised by the URL parser
 * (RFC 5952: lower case, longest zero run compressed); a mapped IPv4 address
 * is unmapped back to dotted form.
 */
export function normalizeIp(raw: string): string | null {
  const ip = raw.trim();
  const family = isIP(ip);
  if (family === 4) return ip;
  if (family !== 6) return null;

  const canonical = new URL(`http://[${ip}]/`).hostname.slice(1, -1);
  if (!canonical.startsWith(MAPPED)) return canonical;
  const tail = canonical.slice(MAPPED.length);
  if (isIP(tail) === 4) return tail;
  const [high = "0", low = "0"] = tail.split(":");
  const word = (parseInt(high, 16) << 16) | parseInt(low, 16);
  return [24, 16, 8, 0].map((shift) => (word >>> shift) & 0xff).join(".");
}

/**
 * Whether a request from `ip` may use a client restricted to `allowed`.
 * No restriction admits anyone; a restriction refuses an address it cannot
 * name, since "we do not know where this came from" is not on the list.
 */
export function ipAllowed(ip: string | null, allowed: string[]): boolean {
  if (allowed.length === 0) return true;
  const from = ip ? normalizeIp(ip) : null;
  if (!from) return false;
  return allowed.some((entry) => normalizeIp(entry) === from);
}
