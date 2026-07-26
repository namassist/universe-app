## Why

Access control in UNIVERSE is currently a browser-side illusion. `lib/access.ts`
holds a 6-role × 30-menu matrix that is duplicated into 114 hardcoded
`mode="view"|"manage"` literals and duplicated a third time into the presence or
absence of `app/{role}/{slug}/` folders — with no mechanism keeping the three in
sync (they have already drifted: `manpower` is granted 8 master-data menus that
have no route and 404). There is no login, no session, and no server-side
authorization; `app/page.tsx` is an open role switcher. The API, meanwhile,
knows only `users(email, name, role: "admin" | "member")` — an enum matching
none of the six roles the product actually uses.

This has to land before any other endpoint is written. Every route needs a
caller identity and a data scope predicate; retrofitting those later means
rewriting each one.

## What Changes

### Authentication

- **BREAKING** — the `users` table and the `user_role` Postgres enum are
  replaced. `role: "admin" | "member"` is dropped in favour of a `role_id`
  foreign key.
- Accounts authenticate by **email or NIK**: both columns nullable and unique,
  with a constraint requiring at least one. Office staff use email, field
  operators use their NIK.
- Sessions are **opaque ids stored in Redis**, issued over two transports that
  resolve to the same record: an httpOnly cookie for web, an
  `Authorization: Bearer` header for mobile. This is the "one session store
  serving both" the README calls for. A web session additionally expires 12
  hours after login — one shift's length — so a session begun at the start of a
  shift does not outlive it on a shared terminal.
- **Accounts are provisioned in bulk from a spreadsheet.** Field operators log
  in, and hundreds of accounts are created at a time by an administrator
  uploading an `.xlsx` — template download, server-side validation preview with
  per-row errors, then an explicit commit that upserts by NIK. The flow reuses
  the pattern `roster-upload.tsx` already established.
- **Initial and reset passwords come from configuration, never from the
  spreadsheet.** An imported or reset account can authenticate but is refused
  everywhere else until it sets its own password.
- **No stateless JWT.** Because roles and permissions become editable at
  runtime, a token carrying its own permissions would keep a revoked
  permission alive until expiry. Server-side sessions make a revocation take
  effect on the next request.

### Authorization (RBAC)

- Roles become database rows, seeded with the six existing roles. They are
  creatable, editable, and deletable at runtime — which is what the existing
  User Management screen already promises.
- Permissions are rows of `(role, menu_slug, mode)`. `MENU_SLUGS` (30),
  `AccessMode`, and `Scope` move to `packages/contracts` and stay **static**: a
  slug corresponds to a page that exists in code, so menus cannot be created at
  runtime even though roles can.
- **BREAKING** — one user has exactly one role. `UmUser.roleIds: string[]`
  becomes `roleId: string`, and the User Management role picker becomes
  single-select.
- **Scope (`all` / `dept` / `self`) is enforced server-side** across employees,
  roster, revisions, attendance, Fit To Work, units, fleet allocation, and
  dashboard aggregates. Both `self` and `dept` accounts are required to carry a
  NIK, since the employee record it identifies is the only link to the caller's
  own data and to its departemen. Departemen is deliberately **not** duplicated
  onto the account — it belongs to the employee record.
- **Correction to seed data** — `manpower` scope changes from `dept` to `all`,
  matching its stated cross-department remit. Its `setting` grant is retained.

### Display devices

- The `type Display` registry already designed in `lib/display-data.ts`
  (`id`, `name`, `kind`, `active`, heartbeat) becomes a real `devices` table.
  A TV must identify itself: `online`, `hb`, and per-device `fleets[]` filtering
  are impossible for an anonymous URL.
- A device is paired once via a **single-use link**, receives a long-lived
  device session, and thereafter reports a heartbeat. Setting `active: false`
  revokes it.
- A device session is read-only and confined to `/display/*`. Devices are not
  users: they carry no role, no scope, and no NIK.

### Web

- **BREAKING** — routes move from `app/{role}/{slug}` to `app/(app)/{slug}`.
  114 `page.tsx` collapse to roughly 30; six role layouts collapse to one.
  Role-in-the-URL cannot survive runtime-created roles, and a URL segment is an
  untrusted claim.
- `mode` is no longer a per-page literal; it is derived from the session via
  `access(slug)`.
- `app/page.tsx` becomes a login page; a new `middleware.ts` guards the shell
  and `/display/*`.
- Fixes the 8 `manpower` master-data routes that `ROLE_ACCESS` grants today but
  that return 404.

### Non-goals

- Wiring the remaining menus' sample data to the API. This change wires
  authentication, RBAC, and User Management only; every other menu keeps its
  static data.
- Employee master data. Accounts carry a NIK as plain text; the foreign key,
  the import-time validation of it, and departemen resolution all activate with
  the master-data change that follows this one.
- Display **content** configuration (`runtexts`, `rotateSec`, `fleets[]`) —
  device identity lands here, its configuration does not.
- Self-service password reset, email delivery, SSO, and MFA.
- The allocation engine, the shift timeline scheduler, and the FTW/fingerprint
  ingestion integrations.
- Choosing production infrastructure, and TLS with it. Both are still open; the
  design isolates everything the answer would change to cookie configuration.

## Capabilities

### New Capabilities

- `auth`: principal identity and session lifecycle — user accounts credentialed
  by email or NIK, display devices paired by single-use link, opaque
  Redis-backed sessions delivered over cookie or bearer, and revocation.
- `rbac`: authorization — runtime-managed roles, per-menu permissions
  (`view` / `manage`), data scope (`all` / `dept` / `self`), and its enforcement
  on both the API and the web shell.

### Modified Capabilities

None. `openspec/specs/` is empty; these are the first capabilities recorded.

## Impact

**`packages/contracts`** — gains `MENU_SLUGS`, `MENU_LABELS`, `AccessMode`,
`Scope`, and session/principal types. **BREAKING**: `USER_ROLES` and the `User`
type are removed. Must stay browser-safe.

**`apps/api`** — new Drizzle schema and migrations (`users` rewritten, `roles`,
`role_permissions`, `devices`); sessions in Redis. New routes under
`/v1/auth/*`, `/v1/roles`, `/v1/users`, `/v1/devices`, each declaring `body`,
`params`, and `response` schemas. A reusable auth macro supplies the caller
principal and a scope predicate to every subsequent route.

**`apps/web`** — the largest surface. Route tree restructured (~114 files
removed or merged), new `middleware.ts` and login page, `RoleProvider` fed from
the session, sidebar hrefs de-role-prefixed, `um-users` and `um-roles` wired to
the API through TanStack Query, `display-admin` backed by the device registry.

**Database** — the existing `users` table and `user_role` enum are dropped and
recreated. Development data in `universe_app` is lost; there is no production
data yet.

**Deployment** — the target is undecided (on-site or cloud) and so is TLS.
Nothing in the session architecture depends on either: `SameSite` and `Secure`
are explicit configuration rather than derivations of `NODE_ENV`, so a
same-origin LAN deployment, a split cloud deployment, and a plain-HTTP network
differ only by their environment file. Serving over plain HTTP does expose
credentials and session identifiers on the wire, which is recorded as a risk in
the design and should be closed before real accounts exist.
