# API architecture

Elysia on Bun. PostgreSQL through Drizzle, sessions in Redis, uploaded files
on disk streamed with `Bun.file`. Everything mounts under `/v1`.

## Module map

```
src/
  index.ts        # composes every route module under /v1, exports `App`
  env.ts          # validated environment (fails fast at startup)
  redis.ts        # ioredis client
  scheduler.ts    # in-process scheduled jobs (timeline stages → hooks)
  ingest.ts       # readiness sync engine: source → snapshot, ingest windows
  sources/        # the two external readiness sources, read-only
    nik.ts        # NIK normalization (the cross-system join key)
    savera.ts     # FTW verdicts from saverawatch (company-filtered)
    nakula.ts     # first-in/first-out taps from the raw tap log
  storage.ts      # SOUND_DIR / PHOTO_DIR / IMPORT_DIR, health-checked at boot
  auth/
    macro.ts      # the auth macro — THE security boundary for every route
    session.ts    # Redis-backed sessions, httpOnly cookie
    principal.ts  # who is calling (user or kiosk device)
    scope.ts      # all / dept / self scope resolution
    password.ts   # hashing
  db/
    schema.ts     # Drizzle schema — source of truth for the database
    index.ts      # client + isUniqueViolation
    seed.ts, seed-master.ts
  routes/
    *.ts          # one Elysia instance per domain; *.test.ts colocated
    schemas.ts    # TypeBox schemas shared between route modules
```

## Request flow

1. `index.ts` mounts each domain router under `/${API_VERSION}` (`/v1`).
   A route module that is not mounted there does not exist.
2. Every protected route declares the auth macro from `auth/macro.ts`. The
   macro resolves the session cookie → principal → effective permissions
   (menu × mode × scope) and rejects before the handler runs. The web proxy
   and shell are user experience; **this macro is the boundary**.
3. Handlers validate with TypeBox (`body`, `params`, `response` — all three,
   always) and talk to Postgres through Drizzle.
4. Non-2xx responses use the shared `ApiError` shape
   (`{ code, message }` from `@universe/contracts`).

## Type export

`index.ts` exports `export type App = typeof app`. The web app's Eden Treaty
client consumes this type directly — no codegen. Renaming a field in a route
breaks the web typecheck; that is the point.

## Startup

Boot pings Postgres, Redis, and each storage directory (`/health` reports
them). The scheduler starts in-process — there is no separate worker.

## Readiness ingest

External readiness data (FTW verdicts from savera, fingerprint taps from
Nakula) is **snapshotted, never queried live from a request path**. The
`ftw-ingest` / `finger-ingest` timeline stages open a bounded ingest window
(`INGEST_WINDOW_MINUTES`, default 5): one pull immediately, another each
minute until it closes, every pass an idempotent upsert on `(nik, date)` —
so the window is retry and late-arrival tolerance in one. Manual pulls:
`POST /v1/fit-to-work/sync`, `POST /v1/attendance/sync` (manage mode).
Source connections are lazy, read-only at the session level, and idle out
between windows. The post-deadline snapshot is _final for the day's
decision_ by business rule — an upload after the deadline does not count.

## The prober

`prober.ts` runs an interval (`PROBE_INTERVAL_SECONDS`, 30 s) — not a timeline
stage, because monitoring is continuous rather than deadline-driven. A full
sweep of ~58 machines takes about 3.5 s, so the interval is chosen for how fast
an outage should surface, not for cost. Each cycle TCP-connects to every active
fingerprint machine on port 4370 and closes immediately: never a ZK session, so
it cannot contend with whatever collects taps into Nakula. Ping would be the
wrong instrument (one machine on site drops ICMP but accepts 4370).

Two details are load-bearing. Probes run **pooled** (`PROBE_CONCURRENCY`)
because firing all of them at once was measured to time out the slower machines
and report them offline while they were reachable. And a machine flips offline
only after `PROBE_MISSES_BEFORE_OFFLINE` consecutive misses, with the counter
persisted so a restart cannot walk a machine back to online.

A Redis lease per cycle keeps several API processes from double-probing, the
same mechanism as the scheduler's claim.

## Kiosk devices

TV displays authenticate as devices (`devices` table) with their own cookie,
separate from user sessions. Device routes live in `routes/devices.ts`.

A device is authorized by the menu owning its **kind** (`MENU_OF_KIND`), not
by whichever display menu the caller happens to hold — so a role scoped to the
fleet board cannot revoke an attendance TV. Pairing is a single-use, 15-minute
Redis token consumed at `GET /v1/devices/pair/:token`, which sets the device
cookie and redirects to that kind's screen. `DISPLAY_ROUTE_OF_KIND` and
`DEVICE_ID_PREFIX` live in `@universe/contracts` so the API and the web admin
share one mapping instead of drifting copies.

## Related docs

- `schema.md` — database entities and relationships
- `rules.md` — mandatory conventions (read before writing a route)
- `design.md` — why it is built this way
