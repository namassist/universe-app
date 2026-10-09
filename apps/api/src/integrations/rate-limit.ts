/**
 * A fixed per-minute request budget for each integration client.
 *
 * Not a defence against a determined attacker — a token holder is trusted to
 * read — but against the honest mistake that actually happens: a sync written
 * as a tight loop, or a retry with no back-off, hammering the API the booths
 * and walls depend on during a muster. A fixed window is enough for that and
 * is one `INCR` per request.
 */

import { redis } from "../redis";

const WINDOW_SECONDS = 60;

const keyOf = (clientId: string, minute: number) =>
  `integration:rate:${clientId}:${minute}`;

export type RateAnswer = { allowed: boolean; retryAfterSeconds: number };

export async function takeRequest(
  clientId: string,
  limit: number,
  now = new Date()
): Promise<RateAnswer> {
  const seconds = Math.floor(now.getTime() / 1000);
  const minute = Math.floor(seconds / WINDOW_SECONDS);
  const key = keyOf(clientId, minute);

  const results = await redis
    .multi()
    .incr(key)
    // Twice the window, so a key outlives its minute however the clock drifts.
    .expire(key, WINDOW_SECONDS * 2)
    .exec();
  const count = Number(results?.[0]?.[1] ?? 0);

  return {
    allowed: count <= limit,
    retryAfterSeconds: WINDOW_SECONDS - (seconds % WINDOW_SECONDS),
  };
}
