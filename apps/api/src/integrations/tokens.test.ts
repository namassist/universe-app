/**
 * The integration token: what is handed to a service once, and what is kept.
 * Pure — no database, no Redis.
 */

import { describe, expect, test } from "bun:test";
import { INTEGRATION_TOKEN_PREFIX } from "@universe/contracts";

import {
  hashToken,
  ipAllowed,
  mintToken,
  normalizeIp,
  presentedToken,
} from "./tokens";

describe("mintToken", () => {
  test("hands out a prefixed token and keeps only its hash", () => {
    const minted = mintToken();

    expect(minted.token.startsWith(INTEGRATION_TOKEN_PREFIX)).toBe(true);
    expect(minted.hash).toBe(hashToken(minted.token));
    expect(minted.hash).not.toContain(minted.token);
    // 32 random bytes, base64url: 43 characters after the prefix.
    expect(minted.token.length).toBe(INTEGRATION_TOKEN_PREFIX.length + 43);
  });

  test("the shown prefix identifies the token without revealing it", () => {
    const minted = mintToken();

    expect(minted.token.startsWith(minted.prefix)).toBe(true);
    expect(minted.prefix.length).toBe(INTEGRATION_TOKEN_PREFIX.length + 6);
  });

  test("two tokens are never the same", () => {
    const seen = new Set(Array.from({ length: 50 }, () => mintToken().token));
    expect(seen.size).toBe(50);
  });
});

describe("hashToken", () => {
  test("is a stable sha256 in hex", () => {
    expect(hashToken("uvk_abc")).toBe(hashToken("uvk_abc"));
    expect(hashToken("uvk_abc")).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken("uvk_abc")).not.toBe(hashToken("uvk_abd"));
  });
});

describe("presentedToken", () => {
  test("reads a bearer token of ours", () => {
    const { token } = mintToken();
    expect(presentedToken(`Bearer ${token}`)).toBe(token);
  });

  test("refuses anything that is not one of our tokens", () => {
    expect(presentedToken(undefined)).toBeNull();
    expect(presentedToken("")).toBeNull();
    expect(presentedToken("Basic dXNlcjpwYXNz")).toBeNull();
    // A user's bearer session id is not an integration token.
    expect(presentedToken(`Bearer ${crypto.randomUUID()}`)).toBeNull();
    expect(presentedToken(`Bearer ${INTEGRATION_TOKEN_PREFIX}`)).toBeNull();
  });
});

describe("ipAllowed", () => {
  test("an empty list admits any address", () => {
    expect(ipAllowed("192.168.151.40", [])).toBe(true);
    expect(ipAllowed(null, [])).toBe(true);
  });

  test("a list admits only its addresses", () => {
    const list = ["192.168.151.40", "192.168.151.41"];
    expect(ipAllowed("192.168.151.41", list)).toBe(true);
    expect(ipAllowed("192.168.151.42", list)).toBe(false);
  });

  test("an unknown address is refused when the list is not empty", () => {
    expect(ipAllowed(null, ["192.168.151.40"])).toBe(false);
  });

  test("an IPv4 address arriving IPv6-mapped is the same address", () => {
    expect(ipAllowed("::ffff:192.168.151.40", ["192.168.151.40"])).toBe(true);
  });
});

describe("normalizeIp", () => {
  test("leaves an IPv4 address as it is", () => {
    expect(normalizeIp("192.168.151.40")).toBe("192.168.151.40");
  });

  test("unmaps an IPv4 address however the socket spelled it", () => {
    expect(normalizeIp("::ffff:192.168.1.5")).toBe("192.168.1.5");
    expect(normalizeIp("::FFFF:192.168.1.5")).toBe("192.168.1.5");
    expect(normalizeIp("::ffff:c0a8:105")).toBe("192.168.1.5");
  });

  test("gives one spelling to every way of writing an IPv6 address", () => {
    expect(normalizeIp("0:0:0:0:0:0:0:1")).toBe("::1");
    expect(normalizeIp("FE80:0000:0000:0000:0000:0000:0000:0001")).toBe(
      "fe80::1"
    );
  });

  test("is null for anything that is not an address", () => {
    expect(normalizeIp("server-hris")).toBeNull();
    expect(normalizeIp("")).toBeNull();
  });
});

describe("ipAllowed, across spellings", () => {
  test("an IPv6 entry matches the address however it arrives", () => {
    expect(ipAllowed("::1", ["0:0:0:0:0:0:0:1"])).toBe(true);
  });

  test("a hex-mapped IPv4 peer matches its dotted entry", () => {
    expect(ipAllowed("::ffff:c0a8:105", ["192.168.1.5"])).toBe(true);
  });
});
