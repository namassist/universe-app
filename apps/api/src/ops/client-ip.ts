/**
 * The address a request came from, as far as this process can honestly say.
 *
 * Behind the deploy's Caddy every request arrives from the proxy, so the
 * socket address is the proxy's and the client's is in `X-Forwarded-For`.
 * The **last** entry is the one the nearest proxy wrote; anything before it
 * was supplied by whoever sent the request and proves nothing. Without
 * `TRUST_PROXY` the header is ignored entirely and the socket is the answer.
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
    if (last) return isIP(last) ? last : null;
  }
  const socket = server?.requestIP?.(request)?.address ?? null;
  return socket && isIP(socket) ? socket : null;
}
