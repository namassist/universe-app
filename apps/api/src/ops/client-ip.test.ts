/**
 * Which address a request is said to come from. It keys the ops login
 * lockout, so a header that is not an address must never become one, and a
 * header nobody vouches for must not be believed at all.
 */

import { afterEach, describe, expect, test } from "bun:test";

import { clientIp } from "./client-ip";

const previousProxy = process.env.TRUST_PROXY;

afterEach(() => {
  if (previousProxy === undefined) delete process.env.TRUST_PROXY;
  else process.env.TRUST_PROXY = previousProxy;
});

const SOCKET = "10.0.0.5";
const server = { requestIP: () => ({ address: SOCKET }) };

const request = (forwarded?: string) =>
  new Request("http://localhost/v1/ops/session", {
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
  });

describe("behind a trusted proxy (TRUST_PROXY=true)", () => {
  test("the last X-Forwarded-For entry is the client — what came before it was the sender's claim", () => {
    process.env.TRUST_PROXY = "true";
    expect(
      clientIp(request("203.0.113.9, 198.51.100.7, 192.168.151.20"), server)
    ).toBe("192.168.151.20");
  });

  test("an IPv6 last entry is taken as it is", () => {
    process.env.TRUST_PROXY = "true";
    expect(clientIp(request("203.0.113.9, 2001:db8::1"), server)).toBe(
      "2001:db8::1"
    );
  });

  test("a last entry that is not an IP is not an address — not the socket's either", () => {
    process.env.TRUST_PROXY = "true";
    for (const forwarded of [
      "<script>x</script>",
      "192.168.151.20, unknown",
      "192.168.151.20, 999.1.1.1",
      "192.168.151.20, 10.0.0.1:443",
    ])
      expect(clientIp(request(forwarded), server)).toBeNull();
  });

  test("with no header the socket address is the answer", () => {
    process.env.TRUST_PROXY = "true";
    expect(clientIp(request(), server)).toBe(SOCKET);
  });
});

describe("without TRUST_PROXY", () => {
  test("X-Forwarded-For is ignored and the socket address is used", () => {
    delete process.env.TRUST_PROXY;
    expect(clientIp(request("192.168.151.20"), server)).toBe(SOCKET);
  });

  test("any value other than true leaves the header ignored", () => {
    process.env.TRUST_PROXY = "1";
    expect(clientIp(request("192.168.151.20"), server)).toBe(SOCKET);
  });

  test("an invalid header changes nothing either", () => {
    delete process.env.TRUST_PROXY;
    expect(clientIp(request("<script>x</script>"), server)).toBe(SOCKET);
  });
});

describe("the socket", () => {
  test("a socket address that is not an IP is not stored as one", () => {
    delete process.env.TRUST_PROXY;
    const odd = { requestIP: () => ({ address: "localhost" }) };
    expect(clientIp(request(), odd)).toBeNull();
  });

  test("no server to ask means no address", () => {
    delete process.env.TRUST_PROXY;
    expect(clientIp(request(), null)).toBeNull();
  });
});
