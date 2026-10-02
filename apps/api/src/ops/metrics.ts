/**
 * What every request leaves behind for the Operations Center.
 *
 * Kept in Redis, not Postgres: these are a rolling day of counters and short
 * lists, read only by one page, and a database row per request would cost more
 * than everything it measures. Each minute is a hash, written by one Lua
 * script so a count, its error tallies and its durations never disagree, and
 * every key expires on its own — there is nothing to clean up.
 *
 * **Recording never fails a request.** It runs after the response has gone,
 * is not awaited by it, and swallows its own errors (logged once a minute at
 * most), because a monitoring page that can take the application down is
 * worse than no monitoring page.
 *
 * **What it keeps about people** (owner, 2026-10-02): for each signed-in user,
 * their name, role and browser, the last route they called and when, and how
 * many requests and errors they made — for a day. Never their NIK or address
 * (owner, 2026-10-02), a request body, a header beyond the user agent, or an
 * error's message: a driver's message routinely carries a connection string.
 */

import { Elysia } from "elysia";
import { OPS_WINDOW_MINUTES } from "@universe/contracts";

import { redis } from "../redis";
import { opsKey } from "./keys";

/** Counters live a little over a day, so "the last 24 hours" is always whole. */
const RETENTION_SECONDS = 25 * 60 * 60;
/** How long a user stays listed after their last request. */
const USER_WINDOW_SECONDS = 24 * 60 * 60;
const SLOW_KEEP = 50;
const ERRORS_KEEP = 100;
const USERS_SHOWN = 100;

const minuteKey = (minute: number) => opsKey(`min:${minute}`);
const routeKey = (minute: number) => opsKey(`route:${minute}`);
const userKey = (id: string) => opsKey(`user:${id}`);
const slowKey = () => opsKey("slow");
const errorsKey = () => opsKey("errors");
const usersKey = () => opsKey("users");

/**
 * Methods a label may carry. The method is the one part of a label the
 * client writes, so an open set let `curl -X AAA1`, `-X AAA2`… mint a new
 * label each — unbounded fields for a day, and a `|` in a method could forge
 * another route's figures (security review, 2026-10-02). Anything else is
 * counted, as `OTHER`.
 */
const KNOWN_METHODS = new Set([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
]);
/** A ceiling on the per-route list, should labels ever grow past the API's routes. */
const ROUTES_SHOWN = 300;

const epochMinute = (ms: number) => Math.floor(ms / 60_000);

/**
 * Bump one minute's totals and one route's figures in that minute, atomically.
 * KEYS: minute hash, route hash. ARGV: route label, ms, is4xx, is5xx, ttl.
 */
const BUMP = `
local function bump(key, prefix)
  redis.call('HINCRBY', key, prefix .. 'n', 1)
  if ARGV[3] == '1' then redis.call('HINCRBY', key, prefix .. 'c4', 1) end
  if ARGV[4] == '1' then redis.call('HINCRBY', key, prefix .. 'c5', 1) end
  redis.call('HINCRBY', key, prefix .. 'sum', ARGV[2])
  local max = tonumber(redis.call('HGET', key, prefix .. 'max') or '0')
  if tonumber(ARGV[2]) > max then redis.call('HSET', key, prefix .. 'max', ARGV[2]) end
  redis.call('EXPIRE', key, ARGV[5])
end
bump(KEYS[1], '')
bump(KEYS[2], ARGV[1] .. '|')
`;

/** Not worth counting: the container's health probe, and this page itself. */
function ignored(path: string, method: string): boolean {
  return (
    method === "OPTIONS" ||
    path === "/health" ||
    path.startsWith("/v1/ops/") ||
    path.startsWith("/openapi")
  );
}

type UserPrincipal = {
  kind: "user";
  id: string;
  name: string;
  roleName: string;
};

function userOf(context: unknown): UserPrincipal | null {
  const principal = (context as { principal?: { kind?: string } }).principal;
  return principal?.kind === "user" ? (principal as UserPrincipal) : null;
}

export type RequestRecord = {
  at: number;
  method: string;
  /** `GET /v1/units/:id` — the pattern, so one route is one line. */
  route: string;
  status: number;
  ms: number;
  errorName: string | null;
  userAgent: string | null;
  user: UserPrincipal | null;
};

async function record(entry: RequestRecord, slowMs: number): Promise<void> {
  const minute = epochMinute(entry.at);
  const ms = Math.max(0, Math.round(entry.ms));
  const is4xx = entry.status >= 400 && entry.status < 500;
  const is5xx = entry.status >= 500;
  const at = new Date(entry.at).toISOString();

  const batch = redis.multi();
  batch.eval(
    BUMP,
    2,
    minuteKey(minute),
    routeKey(minute),
    entry.route,
    String(ms),
    is4xx ? "1" : "0",
    is5xx ? "1" : "0",
    String(RETENTION_SECONDS)
  );

  if (ms >= slowMs) {
    const slow = { at, route: entry.route, status: entry.status, ms };
    batch.lpush(slowKey(), JSON.stringify(slow));
    batch.ltrim(slowKey(), 0, SLOW_KEEP - 1);
  }

  if (is5xx) {
    const error = {
      at,
      route: entry.route,
      status: entry.status,
      name: entry.errorName ?? "Error",
    };
    batch.lpush(errorsKey(), JSON.stringify(error));
    batch.ltrim(errorsKey(), 0, ERRORS_KEEP - 1);
  }

  if (entry.user) {
    const key = userKey(entry.user.id);
    batch.hset(key, {
      name: entry.user.name,
      roleName: entry.user.roleName,
      userAgent: (entry.userAgent ?? "").slice(0, 200),
      lastRoute: entry.route,
      lastStatus: String(entry.status),
      lastSeenAt: at,
    });
    // Recorded before the owner ruled them out; gone on the user's next request.
    batch.hdel(key, "nik", "ip");
    batch.hincrby(key, "requests", 1);
    if (is4xx || is5xx) batch.hincrby(key, "errors", 1);
    batch.expire(key, USER_WINDOW_SECONDS);
    batch.zadd(usersKey(), entry.at, entry.user.id);
    batch.zremrangebyscore(
      usersKey(),
      "-inf",
      entry.at - USER_WINDOW_SECONDS * 1000
    );
  }

  const results = (await batch.exec()) ?? [];
  // `exec` resolves even when a command inside it failed; surface the first.
  const failed = results.find(([error]) => error);
  if (failed) throw failed[0];
}

const pending = new Set<Promise<void>>();
let lastFailureLogged = 0;

function recordDetached(entry: RequestRecord, slowMs: number): void {
  const job = record(entry, slowMs)
    .catch((error: unknown) => {
      const now = Date.now();
      if (now - lastFailureLogged > 60_000) {
        lastFailureLogged = now;
        console.error(
          "[ops] could not record request metrics:",
          error instanceof Error ? error.name : "Error"
        );
      }
    })
    .finally(() => pending.delete(job));
  pending.add(job);
}

/** Tests only: wait for every recording already started. */
export async function flushOpsMetrics(): Promise<void> {
  // Elysia runs afterResponse hooks just after `handle()` settles, so let a
  // timer turn pass before collecting what they started.
  await new Promise((resolve) => setTimeout(resolve, 5));
  await Promise.all([...pending]);
}

/**
 * Mount once, first, on the root app: its hooks are global so they see every
 * route, and mounting it before CORS and auth is what lets their rejections
 * be timed and counted too.
 */
export function opsMetrics(options: { slowMs?: number } = {}) {
  const slowMs = options.slowMs ?? 1000;
  const started = new WeakMap<Request, number>();
  const errorNames = new WeakMap<Request, string>();

  return (
    new Elysia({ name: "ops/metrics", seed: slowMs })
      // onRequest always runs app-wide (it precedes routing), so it takes no scope.
      .onRequest(({ request }) => {
        started.set(request, performance.now());
      })
      .onError({ as: "global" }, ({ request, error }) => {
        errorNames.set(
          request,
          error instanceof Error
            ? error.name
            : String((error as { code?: unknown })?.code ?? "Error")
        );
      })
      .onAfterResponse({ as: "global" }, (context) => {
        try {
          const { request, path, set } = context;
          if (ignored(path, request.method)) return;
          const begun = started.get(request);
          const status = typeof set.status === "number" ? set.status : 200;
          const route = (context as { route?: string }).route;
          const method = KNOWN_METHODS.has(request.method)
            ? request.method
            : "OTHER";
          recordDetached(
            {
              at: Date.now(),
              method,
              route: `${method} ${route || "(unmatched)"}`,
              status,
              ms: begun === undefined ? 0 : performance.now() - begun,
              errorName: errorNames.get(request) ?? null,
              userAgent: request.headers.get("user-agent"),
              user: userOf(context),
            },
            slowMs
          );
        } catch {
          // Never let bookkeeping reach the request.
        }
      })
  );
}

/* ------------------------------------------------------------- reading */

export type OpsMinute = {
  at: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  avgMs: number;
  maxMs: number;
};

export type OpsRoute = {
  route: string;
  requests: number;
  clientErrors: number;
  serverErrors: number;
  avgMs: number;
  maxMs: number;
};

export type OpsSlow = { at: string; route: string; status: number; ms: number };
export type OpsError = {
  at: string;
  route: string;
  status: number;
  name: string;
};
export type OpsUser = {
  userId: string;
  name: string;
  roleName: string;
  userAgent: string | null;
  lastRoute: string;
  lastStatus: number;
  lastSeenAt: string;
  requests: number;
  errors: number;
};

const int = (value: string | undefined) => Number(value ?? 0) || 0;

function figures(hash: Record<string, string>, prefix = "") {
  const requests = int(hash[`${prefix}n`]);
  return {
    requests,
    clientErrors: int(hash[`${prefix}c4`]),
    serverErrors: int(hash[`${prefix}c5`]),
    avgMs: requests ? Math.round(int(hash[`${prefix}sum`]) / requests) : 0,
    maxMs: int(hash[`${prefix}max`]),
    sum: int(hash[`${prefix}sum`]),
  };
}

function parseList<T>(raw: string[]): T[] {
  return raw.flatMap((line) => {
    try {
      return [JSON.parse(line) as T];
    } catch {
      return [];
    }
  });
}

export async function readOpsMetrics(now = Date.now()): Promise<{
  perMinute: OpsMinute[];
  routes: OpsRoute[];
  slow: OpsSlow[];
  errors: OpsError[];
  users: OpsUser[];
}> {
  const last = epochMinute(now);
  const minutes = Array.from(
    { length: OPS_WINDOW_MINUTES },
    (_, i) => last - OPS_WINDOW_MINUTES + 1 + i
  );

  const read = redis.multi();
  for (const minute of minutes) {
    read.hgetall(minuteKey(minute));
    read.hgetall(routeKey(minute));
  }
  read.lrange(slowKey(), 0, SLOW_KEEP - 1);
  read.lrange(errorsKey(), 0, ERRORS_KEEP - 1);
  read.zrevrangebyscore(
    usersKey(),
    "+inf",
    now - USER_WINDOW_SECONDS * 1000,
    "LIMIT",
    0,
    USERS_SHOWN
  );
  const results = ((await read.exec()) ?? []).map(([, value]) => value);

  const perMinute: OpsMinute[] = [];
  const byRoute = new Map<string, ReturnType<typeof figures>>();
  minutes.forEach((minute, i) => {
    const totals = (results[i * 2] ?? {}) as Record<string, string>;
    const routes = (results[i * 2 + 1] ?? {}) as Record<string, string>;
    const f = figures(totals);
    perMinute.push({
      at: new Date(minute * 60_000).toISOString(),
      requests: f.requests,
      clientErrors: f.clientErrors,
      serverErrors: f.serverErrors,
      avgMs: f.avgMs,
      maxMs: f.maxMs,
    });

    const labels = new Set(
      Object.keys(routes).map((field) => field.slice(0, field.lastIndexOf("|")))
    );
    for (const label of labels) {
      const add = figures(routes, `${label}|`);
      const seen = byRoute.get(label);
      byRoute.set(
        label,
        seen
          ? {
              requests: seen.requests + add.requests,
              clientErrors: seen.clientErrors + add.clientErrors,
              serverErrors: seen.serverErrors + add.serverErrors,
              sum: seen.sum + add.sum,
              maxMs: Math.max(seen.maxMs, add.maxMs),
              avgMs: 0,
            }
          : add
      );
    }
  });

  const routes: OpsRoute[] = [...byRoute.entries()]
    .map(([route, f]) => ({
      route,
      requests: f.requests,
      clientErrors: f.clientErrors,
      serverErrors: f.serverErrors,
      avgMs: f.requests ? Math.round(f.sum / f.requests) : 0,
      maxMs: f.maxMs,
    }))
    // A label is a route *pattern* and a known method, so there are only as
    // many as the API has routes; the ceiling is far above that, there only
    // so a future mistake cannot make this list unbounded.
    .sort((a, b) => b.requests - a.requests)
    .slice(0, ROUTES_SHOWN);

  const base = minutes.length * 2;
  const slow = parseList<OpsSlow>((results[base] ?? []) as string[]);
  const errors = parseList<OpsError>((results[base + 1] ?? []) as string[]);
  const userIds = (results[base + 2] ?? []) as string[];

  const userRead = redis.multi();
  for (const id of userIds) userRead.hgetall(userKey(id));
  const userHashes = userIds.length
    ? ((await userRead.exec()) ?? []).map(
        ([, value]) => value as Record<string, string>
      )
    : [];

  const users: OpsUser[] = userIds.flatMap((userId, i) => {
    const hash = userHashes[i];
    if (!hash || !hash.lastSeenAt) return [];
    return [
      {
        userId,
        name: hash.name ?? "",
        roleName: hash.roleName ?? "",
        userAgent: hash.userAgent || null,
        lastRoute: hash.lastRoute ?? "",
        lastStatus: int(hash.lastStatus),
        lastSeenAt: hash.lastSeenAt,
        requests: int(hash.requests),
        errors: int(hash.errors),
      },
    ];
  });

  return { perMinute, routes, slow, errors, users };
}

/** Tests only: clear the test namespace (`ops-test:*`) — never live keys. */
export async function forgetOpsTraffic(): Promise<void> {
  if (process.env.NODE_ENV !== "test") return;
  const keys = await redis.keys(opsKey("*"));
  if (keys.length) await redis.del(...keys);
}
