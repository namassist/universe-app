/**
 * Whether a request comes from the site's own network.
 *
 * Once the installation is reachable through the tunnel, "outside" is a real
 * place, and a few things must not happen from it — a first login above all,
 * because the account is still holding a password everyone was issued
 * (`docs/prd.md`, _Network: reaching the API from a phone_). The address this
 * judges is `clientIp`'s, which Caddy makes the real one on both ways in: the
 * LAN listener writes the peer, the tunnel listener writes `CF-Connecting-IP`.
 *
 * Fails closed: no address, or one this cannot read, is outside.
 */

import { BlockList, isIP } from "node:net";

import { normalizeIp } from "../integrations/tokens";

/**
 * The private ranges and loopback. Out of the box that is the site, since a
 * request through the tunnel carries the caller's public address and a LAN
 * one its private address. `SITE_NETWORKS` replaces this, it does not add to
 * it, so a site that wants to exclude a guest Wi-Fi range can.
 */
const DEFAULT_NETWORKS =
  "10.0.0.0/8,172.16.0.0/12,192.168.0.0/16,127.0.0.0/8,::1/128,fc00::/7";

/**
 * Parse a comma-separated list of networks (`10.20.0.0/16`) or single hosts.
 *
 * Throws on any entry it cannot read. A typo that silently matched nothing
 * would refuse every first login on site, and one discovered at the first
 * morning muster after a deploy, not at boot.
 */
export function parseSiteNetworks(raw: string | undefined): BlockList {
  const source = raw?.trim() || DEFAULT_NETWORKS;
  const list = new BlockList();
  for (const entry of source.split(",").map((part) => part.trim())) {
    const [address = "", prefix, extra] = entry.split("/");
    const family = isIP(address);
    const type = family === 4 ? "ipv4" : "ipv6";
    const max = family === 4 ? 32 : 128;
    const bits = prefix === undefined ? max : Number(prefix);
    if (
      family === 0 ||
      extra !== undefined ||
      (prefix !== undefined && !/^\d+$/.test(prefix)) ||
      bits > max
    )
      throw new Error(
        `SITE_NETWORKS: "${entry}" is not a network (expected e.g. 10.20.0.0/16)`
      );
    list.addSubnet(address, bits, type);
  }
  return list;
}

/** Read once at load, so a bad value stops the API on boot. */
const SITE = parseSiteNetworks(process.env.SITE_NETWORKS);

export function onSiteNetwork(
  ip: string | null,
  networks: BlockList = SITE
): boolean {
  const address = ip ? normalizeIp(ip) : null;
  if (!address) return false;
  return networks.check(address, isIP(address) === 4 ? "ipv4" : "ipv6");
}
