# API design decisions (and why)

ADR-style log. Add an entry when a decision constrains future work; delete an
entry when the constraint is gone.

## D1 — Elysia on Bun, type-first

The API exports its own type (`App`) and Eden consumes it: end-to-end types
with no codegen step. This is why the API is a workspace dependency of web
(`@universe/api` as a **type-only** import) and why every route must declare
full schemas — the types are only as good as the declarations.

## D2 — `/v1` prefix from day one

Web deploys in lockstep with the API; a shipped mobile build does not. Adding
the prefix later means touching every route and client. So it exists before
mobile does.

## D3 — RBAC as data, not code

Role → menu → mode → scope lives in `roles`/`role_permissions` rows, seeded
and editable from the UI. The shared _vocabulary_ (menu slugs, modes, scopes)
lives in `@universe/contracts` so db, API, and client cannot drift.

## D4 — The auth macro is the only boundary (design D10 in the web docs)

The Next.js proxy does a cookie-presence check for UX only. Every API route
re-authorizes independently. A caller who defeats the web layer reaches a
shell with no data.

## D5 — Sessions in Redis

Sessions are hot, small, and expiring — Redis fits, and it keeps auth reads
off Postgres. Consequence: dev needs Redis running; note it is currently
unauthenticated (dev-only convention, never production).

## D6 — Explicit deployment config over environment inference

`COOKIE_SECURE`, `SOUND_DIR`, `PHOTO_DIR`, `IMPORT_DIR` are explicit settings,
not derived from `NODE_ENV`. A browser silently discards a `Secure` cookie
over plain HTTP, so inferring it would break login exactly where it matters
(on-site LAN without TLS). Same logic for storage paths: they depend on how
the API is deployed, not what environment it believes it is in. `/health`
probes each at startup.

## D7 — Files on disk, rows keep paths

Uploads (sounds, photos, import files) stream via `Bun.file`. Postgres never
stores bytes. Consequence: on ephemeral containers the storage dirs must be
mounted volumes or uploads vanish while rows survive.

## D8 — The roster is a mirror of unggul_att, read-only here

`roster-sync.ts` pulls a rolling window from the unggul_att API and reconciles
it: a plan that was cancelled at the source disappears here too. Consequence —
there is no upload and no revision screen; correcting a roster means correcting
it in unggul_att. The `roster_revisions` tables survive as the record of
decisions taken while those screens existed, and nothing writes to them.

## D9 — In-process scheduler

The morning timeline is driven by `scheduler.ts` inside the API process, with
stages as `timeline_stages` rows (editable). No external cron, no worker
fleet — single-site scale does not need one yet. It ticks once a minute on
second :01 of the clock, a chain of timeouts re-measured each time, so a stage
fires a second after its time whatever second the process started on.

A stage's time can mean something to code that never fires it: `ftw-deadline`
and `finger-in` are markers whose _hours_ are the pass rule, and `shift-start`
is the moment the yard walls turn over. That was `ftw-ingest` until the two
had to move apart — the walls want the changeover early so the incoming crew
sees a provisional line-up on the way in, while the pull must sit next to the
upload deadline or it closes before the last on-time upload arrives.
`shiftGates()` reads `shift-start` and falls back to `ftw-ingest`, so an
installation that has not added the stage keeps the changeover it had.

## D10 — First login provisions the account

An employee on the register logs in with their NIK and the issued default
password; if no account exists, login creates one with the `user` role and the
forced-password-change gate armed (`auth/provision.ts`). The register is
already the authority on who works here, so an administrator re-typing the same
NIK into the Users screen was work the system could do itself.

Consequences, all deliberate:

- **The default password is now the gate on the whole register**, not just on
  the accounts an administrator chose to create. Anyone who knows it and a NIK
  can obtain a `self`-scoped account. Treat `DEFAULT_USER_PASSWORD` as a
  credential to be set per installation, not left at whatever the example file
  carries.
- **Deactivating an account still holds.** Provisioning only runs when _no_ row
  exists for the identifier, so `active = false` is never undone by a login.
- **An employee recorded `nonaktif` gets nothing** — the status list is
  positive (`aktif`, `standby`), so a status added later is denied a login
  until someone decides otherwise.
- Administrators are still made by hand. Raising a role is the only account
  work left in the Users screen.
- **From outside the site, D10 does not apply** (D11): login provisions
  nothing there, and an account still on the issued password is refused.

## D11 — The login is reachable from the internet, so its budget is spent first

Owner, 2026-10-17: the installation is opened through a Cloudflare Tunnel
(`docs/deploy.md`, _Opening the installation to the internet_). Until then the
person login had no throttle and D10's issued password was only as exposed as
the LAN. Three rules now hold:

- **Two guess budgets** (`auth/login-throttle.ts`): 10 failures per address,
  everywhere, and 10 per account from outside the site, each per 15 minutes.
  An attempt is reserved in Redis **before** the account is read or the
  password verified, as the Operations Center's is. Success clears the
  account budget and refunds its own attempt to the address, so a carrier's
  CGNAT or an office never runs out on correct logins. It does not clear the
  address's earlier failures, or a guesser holding one real account would
  reset his own every ninth try. The account budget is not spent or checked
  on site, so an outsider can exhaust it but cannot lock its owner out at the
  muster. The price, accepted: whoever knows a NIK can keep that person's
  off-site login refused.
- **A first login happens on site** (`auth/site-network.ts`): provisioning, or
  an account with `mustChangePassword`, from an address outside
  `SITE_NETWORKS` (default: private ranges and loopback) is a 403
  `first_login_on_site`. It is only said after the right password, so a wrong
  one still reads as `invalid_credentials`. A missing or unreadable address
  is outside.
- **At most four argon2 verifications at once** (`auth/password.ts`), shared by
  the person and Operations Center logins. A finishing call hands its slot to
  the next waiter directly, so a newcomer cannot slip in between.

The address is `clientIp`'s. Behind the proxy, a request with no
`X-Forwarded-For` has none, rather than its socket's, which would be another
container's private address and read as the site. The address is only the
client's own because Caddy writes
`X-Forwarded-For` itself on both listeners: the peer on the LAN one, Cloudflare's
`CF-Connecting-IP` on the tunnel one (`deploy/Caddyfile`). Behind cloudflared
without that, every request would carry cloudflared's address, and one
person's typos would lock out everyone at once.

## D11 — The PLAN import saves a default; Reset applies it

The PLAN spreadsheet used to write `fleet_plan_slots` directly, adding and
moving pairings. The owner (2026-10-29) separated the two acts: the file is the
**whole default plan**, committing it replaces `fleet_plan_defaults` (plus one
`fleet_plan_default_imports` audit row) and never touches the live plan, and
`POST /plan/reset` is the only door from the default to the live plan.

Consequences, all deliberate:

- **The engine, the walls and the slips keep reading `fleet_plan_slots`
  alone.** A bad file cannot reach a running shift; a Reset can, so it goes
  through a confirmation dialog backed by `GET /plan/reset/preview`.
- **Capacity is judged within the file.** Neither the live plan nor the old
  default counts; every accepted row does, unchanged ones included.
- **Reset skips and lists, it does not force.** Default pairings that fail
  `pairingRefusal` (planning flag on) today are returned as `skipped` with the
  refusal text. A live pairing already identical to the default stands even if
  it would be refused now: Reset restores, it does not audit.
- **Serialisation.** Import and Reset take the same transaction-scoped advisory
  lock (a row lock cannot protect a table whose rows are all replaced); Reset
  additionally locks every unit either plan names, sorted, before recomputing
  the diff, like the dialog. Max 2 per unit holds because the default is
  validated to at most two per unit and every non-default live pairing is
  released.
- **No default is a state, not an error for reads.** `GET /plan/default` answers
  JSON `null`; the reset routes answer 409 `no_default`.
- `fleet_plan_defaults.employee_id` is `set null` (the kept `nik`/`name` still
  identify the pairing, and Reset lists it as skipped), `unit_id` is `restrict`,
  `import_id` cascades because a commit always replaces every row.

## D12 — PLAN Generate puts spares on today's empty units

Owner (2026-10-30): the PLAN tab fills the units nobody works today from the
shift's spares, so a unit whose operator is on leave is crewed in the plan
before the board is built. The rule is pure (`planGenerate` in
`src/plan-generate.ts`); `routes/fleet-allocation-generate.ts` loads and
writes, and is mounted beside the PLAN routes under `/fleet-allocation`.

- **The engine's spare step without readiness.** Same eligibility
  (`pairingRefusal`, planning flag off, so `aktif` only) and the same order
  (Prioritas Alokasi rank, unranked last, ties `asc(code)`); no FTW, no finger.
  Spares are taken by NIK so the answer is deterministic.
- **Shift from the clock at noon**, not the timeline's `shift-start`: before
  12:00 the day shift, after it the night, on today's roster date. The owner
  named the boundary; the PLAN's crew table already opens on the same rule.
- **Spare = no PLAN slot anywhere**, rostered `D`/`N` for that shift. A holder
  whose own unit is broken down is not moved.
- **A full unit gives up a seat.** With two holders and neither on the shift,
  the standby one is released first, then one not working today, then one on
  the other shift (lower NIK on ties). Max 2 per unit holds; the released
  operator comes back through Reset.
- **Preview, then confirm.** `GET /plan/generate/preview` (view) and
  `POST /plan/generate { shift }` (manage). The commit takes the D11 advisory
  lock, locks every unit in allocation sorted by id, recomputes, and refuses
  409 `shift_changed` when the clock has crossed noon or midnight since the
  preview. History lines carry source `generate`, releases before
  assignments.
- **The commit writes what was previewed.** The preview carries a token, a
  sha256 over its (unit, spare, released holder) lines; the commit recomputes
  under lock and answers 409 `preview_stale` when the token differs, so a
  release nobody saw is never written. It reads only the units it locked.
- **Lock order is units before slots, everywhere.** The commit sets
  `lock_timeout` 5 s (55P03 and 40P01 answer 409 `plan_busy`). The slot
  release route (`DELETE /plan/slots/:unitCode/:nik`) now locks its unit
  first, like the assign route: its history insert needs a key-share lock on
  the unit, and taking the slot first could deadlock with a commit holding
  every unit.

## D13 — `/v1/me` answers only about the caller, so it needs no menu

The mobile app's operator screens (owner, 2026-10-17) are about one person:
their coming shift (`/me/shift`), past seats (`/me/seats`) and notifications.
The NIK is the account's, never the request's, so no grant could widen what
they return, and an operator whose role was trimmed still sees their own
seat. The `self` macro (`requireSelf`) keeps the rest of the gate: a person
and not a screen, and not before the issued password is changed.

FTW and attendance history are the existing lists, which now answer a
`self` caller with their own rows: they ignored scope entirely until
2026-10-17 (`nikInScope`), and a second route for the same rows would be a
second place to get scope wrong.

`/me/shift` is about the shift that matters to the person, not the running
one: opened at 21:00 the evening before a day shift, the running shift is
tonight's. Before the board it is the plan, with the reason a holder would
not keep the unit (breakdown, out of the fleet, the board's own
`pairingRefusal`, a partner rostered alongside). After it, the board's seat,
held back as the slip is.

## D14 — A person's seat is pushed no earlier than the slip prints

`person_notifications` rows are written at the event and wait for
`available_at`: a holder's at once, a spare's and any hand placement's at
`finger-second`. `deliverDue` pushes what has come due, after a board is
stored, after a placement, and at the `finger-second` stage. Delivery never
fails the work that caused it, and with no `FCM_SERVICE_ACCOUNT_FILE` it
sends and marks nothing: the in-app list is the record, the push a nudge.

FCM is spoken directly (HTTP v1, a WebCrypto-signed JWT), not through an SDK:
two requests do not justify a dependency. Only `UNREGISTERED` drops a token.

Hardened after review (2026-10-17):

- **Claimed, then sent.** `deliverDue` claims rows with `UPDATE … WHERE
pushed_at IS NULL RETURNING` before sending, so the `finger-second` stage
  and a placement delivering at once send each row once. A row none of whose
  phones took it is released again and retried inside the 12-hour window.
- **Only an account that may still be told**: active, past its password
  change, and only Android tokens until APNs exists. A deactivated or reset
  account's phone may be in somebody else's hand.
- **A regenerated board reconciles.** What each person was last told about
  each unit is compared with the new board: a seat still waiting for the
  second finger is taken back, one already shown is retracted with
  `seat-removed`, one already known is not announced twice. A board for a
  muster already over announces nothing.
- **At most five phones per account**, the oldest dropped.
- **`/me/seats` returns only shifts strictly before the running one**, or
  before today when the timeline cannot say which is running: a board built
  early for a coming shift would otherwise name a spare's unit before the
  slip.

## D14 — The phone reads what the walls and the Operations Center read

The mobile app (stage 3, 2026-10-18) gets no screen-shaped routes of its
own where one already answers the question, so the phone cannot disagree
with the TV or the ops console:

- **Papan ACTUAL is the fleet wall.** `GET /v1/fleet-allocation/actual/display`
  accepts the `fleet-allocation` menu as well as `display-fleet`. Its photo
  route stays the wall's own.
- **The timeline monitor is the Operations Center's reading.**
  `GET /v1/timeline/runs` (menu `timeline`, view) returns the running shift,
  each stage with its claim and last logged run, and the heartbeat, from
  `ops/muster-stages.ts`, which `/v1/ops/overview` now uses too. Nothing else
  of the Operations Center leaves through it.
- **The Pengawas Lapangan reads what the web reads** (S5): unit status and
  its trail (`/unit-status`), and a scanned card (`/id-card/:nik`, scoped as
  every read of the register). The spec publishes those GETs only; a status
  change, a card's photo and the wall's photo feed stay out (test-asserted).
- **`/me/shift` carries its gates** (`ftwDeadline`, `fingerIn`, `board`,
  `secondFinger`, `busDepart`, "HH:MM" or null), so the app words "Batas
  05:25" from the timeline and never from a constant.

The client is generated from `apps/mobile/openapi.json`, written by
`bun run openapi:mobile` (`mobile-openapi.ts`) from only the routes the app
calls, converted to OpenAPI 3.0 (`openapi-30.ts`, shared with the integration
document) because the Kotlin generator does not read 3.1. Response schemas are
published **without `enum` and `default`**: a build stays installed for weeks,
and a generated enum would fail to read a whole answer the day the API adds a
value. A test fails when the committed copy drifts. Counts and minutes are
`t.Integer`, so they arrive as `Int` rather than `Double`.

## Known debt

- `users` links to employees by NIK string; renaming a NIK orphans the
  account and dept/self scope goes silently blind (`docs/known-issues.md`
  at the repo root).
- TLS undecided (blocks real accounts); Redis unauthenticated in dev.
