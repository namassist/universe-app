/**
 * Which addresses count as the site. It decides whether a first login may
 * happen at all, so an address it cannot place must read as outside, and a
 * mistyped network must stop the API rather than quietly match nothing.
 */

import { describe, expect, test } from "bun:test";

import { onSiteNetwork, parseSiteNetworks } from "./site-network";

describe("the default: private ranges and loopback", () => {
  const networks = parseSiteNetworks(undefined);

  test("LAN addresses are on site", () => {
    for (const ip of ["192.168.1.50", "10.12.0.7", "172.20.3.4", "127.0.0.1"])
      expect(onSiteNetwork(ip, networks)).toBe(true);
  });

  test("IPv6 loopback and unique-local addresses are on site", () => {
    expect(onSiteNetwork("::1", networks)).toBe(true);
    expect(onSiteNetwork("fd12:3456::1", networks)).toBe(true);
  });

  test("a public address is outside", () => {
    for (const ip of ["203.0.113.9", "8.8.8.8", "172.32.0.1", "2001:db8::1"])
      expect(onSiteNetwork(ip, networks)).toBe(false);
  });

  test("an IPv4 address in its mapped IPv6 spelling is judged as IPv4", () => {
    expect(onSiteNetwork("::ffff:192.168.1.50", networks)).toBe(true);
    expect(onSiteNetwork("::ffff:203.0.113.9", networks)).toBe(false);
  });

  test("no address, or something that is not one, is outside", () => {
    for (const ip of [null, "", "unknown", "192.168.1.50:80"])
      expect(onSiteNetwork(ip, networks)).toBe(false);
  });
});

describe("SITE_NETWORKS", () => {
  test("replaces the default rather than adding to it", () => {
    const networks = parseSiteNetworks("10.20.0.0/16");
    expect(onSiteNetwork("10.20.5.5", networks)).toBe(true);
    expect(onSiteNetwork("192.168.1.50", networks)).toBe(false);
  });

  test("takes a comma-separated list, padded, IPv4 and IPv6, with bare hosts", () => {
    const networks = parseSiteNetworks(
      " 10.20.0.0/16 , 2001:db8:5::/48, 192.168.9.9 "
    );
    expect(onSiteNetwork("10.20.1.1", networks)).toBe(true);
    expect(onSiteNetwork("2001:db8:5::7", networks)).toBe(true);
    expect(onSiteNetwork("192.168.9.9", networks)).toBe(true);
    expect(onSiteNetwork("192.168.9.10", networks)).toBe(false);
  });

  test("a blank value is the default, not an empty site", () => {
    expect(onSiteNetwork("192.168.1.50", parseSiteNetworks("  "))).toBe(true);
  });

  test("an entry that is not a network refuses to load", () => {
    for (const raw of [
      "10.20.0.0/33",
      "10.20.0/16",
      "office",
      "10.0.0.0/8,,",
      "fd00::/129",
    ])
      expect(() => parseSiteNetworks(raw)).toThrow(/SITE_NETWORKS/);
  });
});
