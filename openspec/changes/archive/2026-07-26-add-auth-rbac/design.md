## Context

UNIVERSE has no authentication. `app/page.tsx` lists the six roles as links;
opening `/manpower/dashboard` grants manpower's view of the product. All access
decisions live in the browser, in three places that nothing keeps in sync:

1. `ROLE_ACCESS` in `lib/access.ts` — filters the sidebar and topbar.
2. 114 `page.tsx` files, each hardcoding `mode="view"` or `mode="manage"`.
3. The existence of a `app/{role}/{slug}/` folder — the router's own opinion.

They have already drifted: `ROLE_ACCESS.manpower` grants `manage` on eight
master-data menus that have no route, so the sidebar renders links that 404.

The API knows nothing of this. It has one table (`users`) with a
`role: "admin" | "member"` enum matching none of the six real roles, one route
(`/v1/users`), and no notion of a caller.

**Constraints shaping this design:**

- **Roles are runtime data, menus are not.** The existing User Management screen
  (`um-roles.tsx`, 551 lines) already offers create/edit/delete of roles with a
  per-menu permission matrix. Menus, by contrast, are pages that exist in code.
- **Scope is real.** Every role carries `all` / `dept` / `self`, and it must
  filter employees, roster, attendance, FTW, units, fleet allocation, and
  dashboard aggregates. This is only enforceable server-side.
- **Accounts arrive in bulk.** Field operators log in to the web app, and their
  credentials are provisioned by an administrator uploading a spreadsheet — not
  by self-registration. Hundreds of accounts at a time.
- **Two client kinds, one session store.** Web wants httpOnly cookies; a future
  mobile client cannot use them.
- **A third principal: TVs.** Four `/display/*` kiosks run unattended.
  `lib/display-data.ts` already models them as a registry with `online`, a
  heartbeat, and an `active` flag — none of which an anonymous URL can produce.
- **Shifts are 12 hours**, day 06:00–18:00 and night 18:00–06:00, worked on
  shared terminals. Session lifetime has to respect the handover.
- **Deployment is undecided** — on-site LAN or cloud, with or without TLS. The
  session design must not depend on either, and everything that would differ
  between them is isolated to cookie attributes.
- The site operates on **WITA (UTC+8)**. Nothing in this change depends on it,
  but it is recorded here for the shift-timeline work that will.
- **Pre-production.** No real users, no real data. Breaking changes are cheap
  now and expensive in three months.

## Goals / Non-Goals

**Goals:**

- One server-enforced source of truth for who a caller is and what they may do.
- Runtime-editable roles whose changes take effect on the next request.
- Scope enforced in the data layer, not the UI.
- One session store serving cookie and bearer transports.
- Bulk account provisioning by spreadsheet, with a validation preview.
- Display devices authenticated as devices, revocable individually.
- Collapse the three duplicated access matrices into one.

**Non-Goals:**

- Wiring the other menus' sample data to the API.
- Employee master data. Accounts reference a NIK as plain text; the foreign key
  and its validation arrive with the master-data change that follows.
- Display _content_ configuration (`runtexts`, `rotateSec`, `fleets[]`).
- Self-service password reset by email, SSO, and MFA.
- The allocation engine, the shift timeline scheduler, FTW/fingerprint ingest.
- Final infrastructure selection.

## Decisions

### D1 — Opaque Redis sessions, not JWT

A session is a random opaque id. Redis holds `session:<id> → { kind, subjectId }`
with a sliding TTL. Nothing about identity or permissions travels in the token.

_Why:_ the product requires that an admin revoke a permission through the Roles
screen and have it apply. A JWT carrying permissions keeps a revoked permission
valid until expiry; deactivating a user or a TV has the same lag. Sessions also
let a single record back both transports.

_Alternative rejected:_ JWT with a short TTL plus a refresh token. It reduces
the revocation window but does not close it, and it adds a second token
lifecycle for no benefit here — Redis is already a dependency
(`apps/api/src/redis.ts`, db index 2) and the API is a long-lived process, not
serverless.

### D2 — Two transports, one record; a web session lasts one shift's length

| Client | Transport                                                      | Idle timeout | Absolute expiry              |
| ------ | -------------------------------------------------------------- | ------------ | ---------------------------- |
| Web    | `universe_session` cookie — httpOnly, `SameSite=Lax`, `Path=/` | 4h sliding   | **12h from issuance**        |
| Mobile | `Authorization: Bearer <id>`                                   | 30d sliding  | —                            |
| Device | `universe_device` cookie — same attributes                     | —            | 365d, refreshed on heartbeat |

Both cookie and bearer carry the same opaque id and resolve through the same
lookup. Device cookies use a distinct name so a browser can hold both and a
device session is never mistaken for a user session.

_Why 12 hours from issuance:_ a shift is exactly 12 hours, so whoever logs in at
the start of a shift is signed out at the end of it — which is the property
worth having, since a session left open on a shared terminal otherwise lets the
incoming operator work under the outgoing one's identity. A 4-hour idle window
absorbs breaks without forcing a re-login mid-shift.

_Alternative rejected — expiry at the 06:00/18:00 wall clock._ It expresses the
same intent but produces stub sessions at exactly the wrong moment: logging in
at 17:50 yields a ten-minute session. Someone signing in near a boundary is
almost always the _incoming_ shift arriving early, and they need a full window,
not a remainder. Measuring from issuance gives the same outcome for the common
case, has no edge cases, and needs no timezone configuration.

_What no expiry rule solves:_ if the outgoing operator walks away at 18:00 and
the incoming one sits down at 18:05, no timeout has yet fired. Handover hygiene
is a visible logout control, not expiry arithmetic — hence the logout action in
the topbar rather than a shorter TTL.

`Secure` is driven by its own configuration flag rather than by `isProd`,
because a deployment may serve plain HTTP: a browser silently discards a
`Secure` cookie over HTTP, so tying the flag to the environment would break
login in exactly the setup that needs it most. Under a same-origin deployment
there is no CORS and `Lax` suffices; if web and API later split across sites,
only these attributes change (`SameSite=None; Secure` plus credentialed CORS) —
D1 and everything downstream are untouched.

### D3 — Permission snapshots cached in Redis, invalidated on write

Resolving a request must not cost two Postgres queries. Two caches:

```
princ:user:<id>    → { roleId, scope, nik, active, mustChangePassword }
princ:device:<id>  → { active }
perms:<roleId>     → { [menuSlug]: "view" | "manage" }
```

Writes invalidate precisely: editing a role `DEL perms:<roleId>`; editing or
deactivating a user `DEL princ:user:<id>`; deactivating a device
`DEL princ:device:<id>`. A cache miss falls back to Postgres and repopulates.

This is what makes D1's immediate revocation affordable, and it is why session
records deliberately hold no permission data.

### D4 — Roles in the database, menu slugs in contracts

```
roles                          role_permissions
  id        uuid pk              role_id    fk roles  on delete cascade
  slug      text unique          menu_slug  text
  name      text                 mode       access_mode  -- view | manage
  description text               pk (role_id, menu_slug)
  scope     scope  -- all|dept|self
  locked    boolean
```

Absence of a row means no access; `"none"` is never stored. `menu_slug` is
validated against `MENU_SLUGS` from `packages/contracts` at the API boundary
rather than by a Postgres enum, so adding a menu is a code change and a seed,
not a migration.

`MENU_SLUGS`, `MENU_LABELS`, `AccessMode`, and `Scope` move from
`apps/web/lib/access.ts` into `packages/contracts`. `ROLE_ACCESS` and `ROLES`
are deleted — they become seed data.

_Why not fully dynamic menus:_ a slug without a page is a dead link, and the
codebase already proves it (the eight orphaned manpower routes). Menus are code.

### D5 — One role per user; identity is email or NIK; no departemen column

```
users
  id                    uuid pk
  email                 text unique null
  nik                   text unique null
  name                  text not null
  password_hash         text not null
  must_change_password  boolean not null default true
  role_id               uuid fk roles on delete restrict
  active                boolean default true
  CHECK (email is not null or nik is not null)
```

Passwords use `Bun.password` (argon2id) — no new dependency.

**Scope invariants**, enforced in the application layer when a role is assigned
because they span both tables:

| Scope  | Requires    |
| ------ | ----------- |
| `all`  | nothing     |
| `dept` | `users.nik` |
| `self` | `users.nik` |

**There is deliberately no `users.departemen` column.** Departemen is an
attribute of the employee, not of the account — `Employee.dept` already exists
in `lib/employees-data.ts`. Duplicating it onto `users` would create two
sources of truth for the same fact, and a transfer between departments would
have to be written in both places. Instead a `dept`-scoped caller resolves
through `users.nik → employees.nik → employees.dept`, which collapses both
non-trivial scopes onto a single prerequisite: a NIK.

_The transitional gap is empty._ Employee master data lands in a later change,
so that resolution is not yet available — but nothing dept-scoped exists in the
API after this change either. The only persisted collections are `users`,
`roles`, and `devices`, and User Management is `superadmin`-only, which is
`all`-scoped. Every dept-scoped domain (employees, roster, attendance, FTW,
units, fleet allocation) is still static data in the web app. A `departemen`
column would sit unused for its entire life and then be redundant.

Until employee data lands, a `dept`-scoped principal whose departemen cannot be
resolved yields an **empty result set, never an unfiltered one** (see D8).

_Consequence:_ `UmUser.roleIds: string[]` becomes `roleId`, and the User
Management picker becomes single-select. Sample user `u8` (`["r-user",
"r-manpower"]`) must choose one.

### D6 — Devices are principals, not users

```
devices
  id            text pk        -- "DSP-A01", as already designed
  name          text           -- "TV Gate Utara"
  kind          device_kind    -- att | fleet | fitwork | fingerprint
  active        boolean
  last_seen_at  timestamptz null
```

A device has no role, no scope, no NIK, and no password. Its authorization is
fixed in code: read-only, `/display/*` only, never the admin shell. Modelling a
TV as a `users` row would violate the email-or-NIK constraint, make `scope`
meaningless, and misrepresent per-device `fleets[]` filtering as an RBAC concept.

`kind` covers all four kiosks so each can be paired and revoked uniformly. Only
`att` and `fleet` have an admin UI (`display-admin.tsx`); `fitwork` and
`fingerprint` are provisioned through the API and the seed, which is a
deliberate choice not to add a menu slug for them.

**Pairing:**

```
1. an authorized caller registers a TV  → Display Attendance / Display Fleet menu
2. API returns a single-use link        → Redis pairing:<token> → deviceId, TTL 15m
3. link opened once on the TV           → token consumed, universe_device cookie set
4. TV polls for data                    → devices.last_seen_at updated
                                            └─► online / hb become computable
5. active = false                       → princ:device cache dropped, session rejected
```

The pairing token lives only in Redis, so an unused link expires on its own and
a used one cannot be replayed.

### D7 — An Elysia macro supplies principal and scope to every route

```ts
.get("/employees", ({ principal }) => …, {
  auth: { menu: "employees", mode: "view" },
})
```

The macro resolves the session, loads the cached principal and permission set,
rejects with 401 (no session) or 403 (insufficient mode), and injects
`principal`. Handlers then apply a scope predicate:

```ts
scopeWhere(principal, { dept: employees.dept, self: employees.nik });
//  all  → no filter
//  dept → dept of the employee identified by principal.nik
//  self → eq(self, principal.nik)
```

Declaring it per route keeps the OpenAPI spec accurate, which is what a future
mobile client generates from.

### D8 — Scope semantics per domain

| Domain                       | `all`     | `dept`                  | `self`        |
| ---------------------------- | --------- | ----------------------- | ------------- |
| Employees                    | all       | caller's departemen     | own NIK       |
| Roster, revisions, approvals | all       | employee's dept         | own rows      |
| Attendance                   | all       | dept                    | own rows      |
| Fit To Work                  | all       | dept                    | own rows      |
| Units                        | all       | `unit.departemen` match | _unreachable_ |
| Fleet allocation             | all       | units within dept       | _unreachable_ |
| Dashboard aggregates         | site-wide | dept-limited            | own figures   |

No `self`-scoped role holds a unit or fleet menu, so those cells are
unreachable by construction. The API returns an empty set rather than erroring —
fail closed, so a future role that reaches them leaks nothing.

**Fail closed on unresolvable scope.** A `dept`-scoped caller whose departemen
cannot be determined — no employee record for its NIK, or employee data not yet
in the database — receives an empty set, never the unfiltered collection. This
is what makes the transitional state described in D5 safe rather than open.

Seed correction: `manpower` moves from `dept` to `all`, matching its stated
cross-department remit. Without it, the fleet board — which spans departments —
would be truncated for the role that owns it.

### D9 — Route migration: move superadmin, delete the rest

Verified: `app/superadmin/` is a **strict superset** of the other five role
trees. Every `page.tsx` path under `admin`, `manajer`, `manpower`, `medic`, and
`user` also exists under `superadmin`. So the migration is not a 114-file
rewrite:

```
app/superadmin/**  →  app/(app)/**        move  (40 files)
app/{admin,manajer,manpower,medic,user}/  delete (74 files)
app/page.tsx  role switcher → redirect: session ? /dashboard : /login
app/(auth)/login/page.tsx                 new
middleware.ts                             new
```

Then strip `mode="…"` from the moved pages: `<MenuPage slug="employees" />`
resolves its own mode through `useRole().access(slug)` and renders not-found
when the slug is undefined for the caller. Six role layouts collapse to one
`(app)/layout.tsx` that reads the session and feeds `RoleProvider`.

Side effect: the eight orphaned manpower master routes are fixed for free —
there is now one set of pages and permission alone decides reachability.

_Why big-bang rather than incremental:_ role-in-the-URL and role-from-session
cannot coexist, since the URL segment would be an unverified claim sitting
beside a verified one. There are no production users to migrate.

### D10 — The web guard is UX; the API is the boundary

`middleware.ts` performs a cheap check — is a session cookie present — and
redirects to `/login` if not. It does not talk to Postgres and is not
authoritative. Real authorization happens twice: in `(app)/layout.tsx`, which
fetches the session server-side and redirects or 404s, and independently in
every API route through the D7 macro.

A caller who defeats the middleware gains a shell with no data: every endpoint
behind it re-checks.

### D11 — Bulk account provisioning by spreadsheet

Accounts are created in bulk by an administrator, never by self-registration.
The flow reuses the upload pattern the repo already established in
`roster-upload.tsx` rather than inventing a second one:

```
download template  →  dropzone  →  server-side parse  →  validation preview
                                                            (per-row errors)
                                                                  ↓
                                              explicit confirm  →  commit
```

The preview reuses the existing `UpError` shape (`row`, `nik`, `emp`, `issue`,
`badge`) so the results table looks and behaves like the roster upload's.

**Format is `.xlsx`**, matching the repo convention — roster upload accepts
`.xlsx`, employee export writes `.xlsx`. This adds a spreadsheet parser to
`apps/api`. Parsing is server-side: the browser is never the validator.

**Columns:** `nik`, `nama`, `email` (optional), `role`. No `departemen`, per D5.
**No password column** — a spreadsheet carrying credentials circulates by email
and chat, and the initial password comes from D12 instead.

**Upsert by NIK.** Re-running a corrected file is the normal case for hundreds
of rows, not an exception, so a matching NIK updates rather than erroring. The
preview separates _new_ from _updated_ rows and shows what each update changes,
so a role edited by hand is never silently overwritten — the commit is explicit.

**NIK is stored as plain text with no referential check**, because employee
master data lands later (D5). A row whose NIK matches no employee is accepted
for now; once employee data exists, the same validation the roster upload
already specifies — _"NIK tidak terdaftar di data karyawan"_ — applies here too.

Importing requires `manage` on the `users` menu, which the seeded matrix grants
to `superadmin` alone.

### D12 — Initial and reset passwords come from configuration

Imported accounts, and accounts reset through the User Management screen,
receive a default password read from an environment variable, and have
`must_change_password` set. Such an account authenticates successfully but is
refused by every route except change-password until it sets a new one.

_Why not random per-account passwords:_ they would have to be delivered back to
hundreds of individuals, which in practice means exporting a spreadsheet of
plaintext passwords — exactly what D11 refuses to create. A shared default that
cannot survive first login is the smaller exposure, provided the gate is real.

**Policy.** A password must be at least a configured minimum length, defaulting
to 8 characters, and **must not equal the configured default**. That second rule
is what stops the gate from being theatre: without it an account satisfies the
forced change by retyping the password it was issued, and one shared secret
survives across every provisioned account indefinitely. The minimum is
configuration rather than a constant so it can be raised without a code change.

The bootstrap superadmin's password is held to the same minimum at seed time, so
the most privileged account cannot be weaker than the policy it enforces on
everyone else.

## Risks / Trade-offs

**Every imported account shares one password until first login** → The
`must_change_password` gate refuses all other routes, so the window is one
login. The default is configuration, never a literal in the repo, and its
rotation is documented alongside the seed variables.

**Upsert could overwrite a hand-edited role** → The preview separates new from
updated rows and names the fields each update would change; nothing is written
before an explicit confirm.

**A spreadsheet parser is a new API dependency** → Parsing stays server-side,
upload size is capped, and unknown columns are rejected rather than ignored, so
a malformed or hostile file fails validation instead of reaching the database.

**Without TLS, credentials and session ids cross the network in the clear** →
A deployment served over plain HTTP exposes passwords at login, allows a session
cookie to be copied and replayed by anyone on the same network, and cannot set
`Secure` at all. The design does not paper over this: `COOKIE_SECURE` is
explicit configuration, so enabling TLS is a flag rather than a code change, and
the exposure is recorded rather than assumed away. Terminating TLS at the
reverse proxy — an internal CA is sufficient on a closed network — should land
before real accounts exist. Deferred here only because the deployment target is
itself undecided.

**The `users` table and `user_role` enum are dropped and recreated** → No
production data exists; dev data in `universe_app` is disposable. The migration
is destructive by design rather than carrying a dead enum forward.

**A single big-bang route migration across ~114 files** → D9 reduces it to one
move plus five deletions, and `MENU_SLUGS` is the completeness checklist. Each
web task ends with the full pipeline (`rm -rf .next`, prettier, `tsc --noEmit`,
eslint, `next build`).

**Losing the bootstrap superadmin locks everyone out** → The seed creates it
from environment variables and is idempotent. The `superadmin` role is `locked`
(non-deletable), and the API refuses to delete or deactivate the last active
user holding an `all`-scoped `manage` grant on `roles`.

**A long-lived device cookie on a TV browser someone can touch** → It grants
read-only `/display/*` and nothing else. Revocation is one toggle on a screen
that already exists, and pairing links are single-use with a 15-minute TTL.

**`dept` scope is inert until employee data lands** → By D8 it fails closed to
an empty set, and by D5 no dept-scoped collection is served by the API yet, so
the inert period is invisible rather than permissive.

**Cached permissions could go stale if an invalidation path is missed** → All
writes flow through the roles/users/devices routes, so invalidation lives beside
each write; caches carry a short TTL as a backstop so a missed `DEL` self-heals
rather than persisting.

## Migration Plan

Ordered so each layer compiles against the one below.

1. **`packages/contracts`** — add `MENU_SLUGS`, `MENU_LABELS`, `AccessMode`,
   `Scope`, principal and session types. Remove `USER_ROLES` and `User`.
2. **`apps/api` schema** — drop and recreate `users`; add `roles`,
   `role_permissions`, `devices`. Generate and commit the migration.
3. **Seed** — six roles with their permission rows transcribed from
   `ROLE_ACCESS` (with the manpower scope correction), plus a bootstrap
   superadmin from env. Idempotent.
4. **`apps/api` auth** — session store with the D2 lifetimes, `Bun.password`,
   the D7 macro, `/v1/auth/login|logout|session|change-password`, device pairing
   and heartbeat.
5. **`apps/api` management routes** — `/v1/roles`, `/v1/users`, `/v1/devices`,
   password reset, and the D11 import endpoints, each with cache invalidation
   and full request/response schemas.
6. **`apps/web` shell** — login page, forced change-password page,
   `middleware.ts`, `(app)/layout.tsx` reading the session, `RoleProvider` fed
   from it.
7. **`apps/web` routes** — execute D9: move, delete, strip `mode`.
8. **`apps/web` wiring** — `um-users` (including import and reset),
   `um-roles`, and `display-admin` onto the API through TanStack Query
   `queryOptions`; mutations invalidate.

**Rollback:** pre-production, so rollback is `git revert` plus re-running
migrations against a fresh database. No data preservation path is needed, and
building one would be wasted work.

## Open Questions

- **Where does this deploy, and does it carry TLS?** On-site LAN or cloud is
  still open, and TLS with it. Deliberately deferred: the only thing the answer
  changes is `COOKIE_SECURE` and `SameSite`, both configuration. It must be
  settled before real accounts exist, for the reason recorded under Risks.
  Employee master data is the change immediately following this one, which is when
  D11's NIK validation and D5's departemen resolution stop being stubs. Both are
  written so that landing them is additive — a foreign key and a validation rule,
  not a rework.
