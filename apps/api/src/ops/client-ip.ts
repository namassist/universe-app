/**
 * The address a request came from, as far as this process can honestly say.
 *
 * Behind the deploy's Caddy every request arrives from the proxy, so the
 * socket address is the proxy's and the client's is in `X-Forwarded-For`.
 * The **last** entry is the one the nearest proxy wrote; anything before it
 * was supplied by whoever sent the request and proves nothing. Without
 * `TRUST_PROXY` the header is ignored entirely and the socket is the answer.
 *
 * With it, a request carrying no header has no address (security review,
 * 2026-10-17). Caddy writes the header on every request it forwards, so one
 * without it did not come through Caddy: its socket is some other container
 * on the compose network, and that private address would read as the site
 * and earn a first login (`auth/site-network.ts`).
 */

import { isIP } from "node:net";

import { trustProxy } from "../env";

type RequestIpSource = {
  requestIP?: (request: Request) => { address: string } | null;
} | null;

export function clientIp(
  request: Request,
  server: RequestIpSource
): string | null {
  if (trustProxy()) {
    const forwarded = request.headers.get("x-forwarded-for");
    const last = forwarded?.split(",").at(-1)?.trim();
    // Not an address is not an address: never stored, never a lockout key.
    return last && isIP(last) ? last : null;
  }
  const socket = server?.requestIP?.(request)?.address ?? null;
  return socket && isIP(socket) ? socket : null;
}
