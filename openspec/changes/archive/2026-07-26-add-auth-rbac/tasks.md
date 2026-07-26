## 1. Shared contracts

- [x] 1.1 Move `MENU_SLUGS`, `MENU_LABELS`, and `MenuSlug` from `apps/web/lib/access.ts` into `packages/contracts/src`, keeping all 30 slugs and their Indonesian labels unchanged
- [x] 1.2 Add `ACCESS_MODES = ["view", "manage"]` with `AccessMode`, and `SCOPES = ["all", "dept", "self"]` with `Scope`, to `packages/contracts/src`
- [x] 1.3 Add principal and session types to contracts: `SessionPrincipal` (user or device discriminated union), `EffectivePermissions` (`Partial<Record<MenuSlug, AccessMode>>`), and the login/session response shapes
- [x] 1.4 Add the account-import contract types: template column list, per-row preview entry tagged `new` or `updated`, and the per-row error shape mirroring `UpError` (`row`, `nik`, `emp`, `issue`, `badge`)
- [x] 1.5 **BREAKING** — remove `USER_ROLES`, `UserRole`, and the `User` type from contracts; confirm nothing server-only leaked in (no db client, no secrets, no node builtins)
- [x] 1.6 Delete `ROLES`, `ROLE_LABELS`, and `ROLE_ACCESS` from `apps/web/lib/access.ts`; re-export the contracts symbols from it so existing imports keep resolving during the migration

## 2. Database schema

- [x] 2.1 Add `scope` and `access_mode` pgEnums sourced from the contracts constants, so db, API, and client cannot drift
- [x] 2.2 Add the `roles` table (`id`, `slug` unique, `name`, `description`, `scope`, `locked`, `created_at`)
- [x] 2.3 Add the `role_permissions` table (`role_id` FK cascade, `menu_slug` text, `mode`, primary key on `role_id` + `menu_slug`); store only `view`/`manage`, never `none`
- [x] 2.4 **BREAKING** — rewrite the `users` table: drop the `user_role` enum and `role` column; add `nik` (unique, nullable), `password_hash`, `must_change_password` (default true), `role_id` FK restrict, `active`; make `email` nullable and unique. Deliberately **no** `departemen` column — see design D5
- [x] 2.5 Add the `CHECK (email IS NOT NULL OR nik IS NOT NULL)` constraint on `users`
- [x] 2.6 Add the `devices` table (`id` text PK, `name`, `kind` enum `att|fleet|fitwork|fingerprint`, `active`, `last_seen_at`, `created_at`)
- [x] 2.7 Run `bun run --cwd apps/api db:generate` and commit the migration under `apps/api/drizzle/`
- [x] 2.8 Apply with `bun run --cwd apps/api db:migrate` and confirm the constraint rejects a row with neither email nor NIK

## 3. Seed and configuration

- [x] 3.1 Write an idempotent seed that creates the six roles with their scopes: `superadmin` all + locked, `admin` dept, `manajer` dept, `manpower` **all**, `medic` all, `user` self
- [x] 3.2 Transcribe the permission rows for each role from the matrix recorded in `specs/rbac/spec.md`, retaining `manpower`'s `setting` grant
- [x] 3.3 Seed a bootstrap superadmin account from environment variables (identifier + password), hashed with `Bun.password`
- [x] 3.4 Add the configuration this change introduces to `apps/api/.env.example` and `src/env.ts`: bootstrap credentials, `DEFAULT_USER_PASSWORD`, `PASSWORD_MIN_LENGTH` (default 8), session idle and absolute windows, and `COOKIE_SECURE` — the last as its own flag, not derived from `NODE_ENV`, since a deployment may serve plain HTTP
- [x] 3.5 Make the seed reject a bootstrap password shorter than `PASSWORD_MIN_LENGTH` with a clear error, so the superadmin cannot be weaker than the policy it enforces
- [x] 3.6 Seed device records for the `fitwork` and `fingerprint` kiosks, which have no admin UI by design
- [x] 3.7 Verify re-running the seed produces no duplicate roles, permission rows, or devices

## 4. API — sessions and authentication

- [x] 4.1 Implement the Redis session store: create, resolve, extend, and delete `session:<id>`, holding only `{ kind, subjectId }`
- [x] 4.2 Implement the D2 lifetimes — for web, a 4h sliding idle window capped by an absolute expiry 12h after issuance; 30d sliding for bearer clients with no absolute cap; 365d for devices, refreshed on heartbeat
- [x] 4.3 Implement the principal and permission caches — `princ:user:<id>`, `princ:device:<id>`, `perms:<roleId>` — with Postgres fallback on miss and a short backstop TTL
- [x] 4.4 Implement `POST /v1/auth/login`: resolve the identifier against email then NIK, verify with `Bun.password`, reject inactive accounts, and return equal-shaped 401s with comparable timing for unknown identifier and wrong password
- [x] 4.5 Set the `universe_session` cookie (httpOnly, `SameSite=Lax`, `Path=/`, `Secure` per `COOKIE_SECURE`) for browser logins, and return the identifier in the body for bearer clients
- [x] 4.6 Implement `POST /v1/auth/logout` — delete the session record and clear the cookie
- [x] 4.7 Implement `GET /v1/auth/session` returning identity, role name, scope, `mustChangePassword`, and the effective menu-to-mode map
- [x] 4.8 Implement `POST /v1/auth/change-password`, enforcing `PASSWORD_MIN_LENGTH` and rejecting the configured default as a new password, then clearing `must_change_password` and invalidating the principal cache
- [x] 4.9 Gate every route except logout, session, and change-password behind `must_change_password === false`, returning a distinguishable 403 the web shell can redirect on
- [x] 4.10 Ensure no endpoint's response schema can emit `password_hash`

## 5. API — authorization

- [x] 5.1 Build the Elysia auth macro accepting `{ menu, mode }`: resolve session, load cached principal and permissions, respond 401 without a session and 403 without the grant, and inject `principal`
- [x] 5.2 Reject device sessions on every non-display route with 403, and on every mutating route regardless of path
- [x] 5.3 Implement `scopeWhere(principal, { dept, self })`: no filter for `all`, NIK equality for `self`, and departemen resolved through the caller's employee record for `dept`
- [x] 5.4 Make `scopeWhere` fail closed — an empty-set predicate when a scope has no meaningful column on the target table, and when a `dept` caller's departemen cannot be resolved because employee data does not exist yet
- [x] 5.5 Port `/v1/users` onto the macro as the first consumer, with `body`, `params`, and `response` schemas declared

## 6. API — management routes

- [x] 6.1 Implement `/v1/roles` CRUD with `manage`-on-`roles` enforcement; reject deleting a `locked` role or one still assigned, returning 409 with the holder count
- [x] 6.2 Validate every submitted `menu_slug` against the contracts list; 422 on unknown slugs
- [x] 6.3 Enforce the scope invariants on role assignment and on role scope changes: both `self` and `dept` require the account to carry a NIK; 409 identifying holders that a scope narrowing would invalidate
- [x] 6.4 Implement `/v1/users` CRUD with single-role assignment and an activation toggle; refuse to deactivate or delete the last active account holding `manage` on `roles`
- [x] 6.5 Implement `POST /v1/users/:id/reset-password` — set the configured default, set `must_change_password`, invalidate the principal cache
- [x] 6.6 Implement `GET /v1/users/import/template` returning an `.xlsx` with the columns `nik`, `nama`, `email`, `role` and no password column
- [x] 6.7 Implement `POST /v1/users/import/validate`: parse the uploaded `.xlsx` server-side, cap upload size, reject unknown columns, and return a preview marking each row `new` or `updated` with the fields an update would change, plus per-row errors in the shared error shape
- [x] 6.8 Implement `POST /v1/users/import/commit`: upsert by NIK, apply the configured default password with `must_change_password` to new accounts, and leave existing passwords untouched on updates
- [x] 6.9 Accept a NIK that matches no employee record — validation is stubbed until employee master data lands (design D11) — while still rejecting duplicate NIKs within the same file
- [x] 6.10 Restrict all import and reset endpoints to `manage` on the `users` menu
- [x] 6.11 Implement `/v1/devices` CRUD plus `POST /v1/devices/:id/pairing` returning a single-use link backed by `pairing:<token>` in Redis with a 15-minute TTL
- [x] 6.12 Implement pairing consumption: set the `universe_device` cookie, delete the token, redirect to the device's display route; 401 on reused or expired tokens
- [x] 6.13 Implement the device heartbeat — update `last_seen_at` on display data reads — and derive `online` plus a last-seen label in the device listing
- [x] 6.14 Wire cache invalidation into every write path: `DEL perms:<roleId>` on role edits, `DEL princ:user:<id>` on account edits, resets, and imports, `DEL princ:device:<id>` on device deactivation
- [x] 6.15 Confirm the generated OpenAPI spec at `/openapi` is complete for all new routes

## 7. Web — session plumbing

- [x] 7.1 Add `lib/queries/session.ts` with a `queryOptions` for the session endpoint, fetched through Eden and `unwrap`
- [x] 7.2 Build the login page at `app/(auth)/login/page.tsx` using existing `components/ui` primitives and design tokens only — one identifier field accepting email or NIK, plus password
- [x] 7.3 Build the forced change-password page, shown whenever the session reports `mustChangePassword`, blocking access to the rest of the shell
- [x] 7.4 Add `middleware.ts` performing the cheap cookie-presence check and redirecting to `/login`; add a comment recording that it is UX, not the security boundary
- [x] 7.5 Create `app/(app)/layout.tsx` that fetches the session server-side, redirects to `/login` on 401 and to change-password when required, and feeds `RoleProvider`
- [x] 7.6 Rewrite `components/providers/role-context.tsx` to take the session's permission map instead of a hardcoded `Role`, keeping the `access(slug)` API so consumers do not change
- [x] 7.7 Replace `app/page.tsx` — the open role switcher — with a redirect to `/dashboard` or `/login`
- [x] 7.8 Point the topbar identity at the session instead of `ROLE_ACCOUNTS`, and add a logout action

## 8. Web — route migration

- [x] 8.1 Move `app/superadmin/**` to `app/(app)/**` — verified as a strict superset of all five other role trees, so this carries the complete page set
- [x] 8.2 Delete `app/admin/`, `app/manajer/`, `app/manpower/`, `app/medic/`, and `app/user/`
- [x] 8.3 Strip the `mode` prop from every moved `page.tsx`, leaving `<MenuPage slug="…" />`
- [x] 8.4 Make `MenuPage` resolve its own mode via `useRole().access(slug)` and render not-found when the slug is undefined for the caller
- [x] 8.5 Drop the `/{role}` prefix from `hrefOf` in `components/layout/sidebar.tsx` and from `groupOfPath`, which reads the slug from the wrong path segment once the prefix is gone
- [x] 8.6 Sweep for remaining role-prefixed links and redirects across `app/` and `components/`, including `roster-upload.tsx`'s `listHref`
- [x] 8.7 Confirm the eight previously orphaned manpower master-data menus now resolve, since one page set now serves every role

## 9. Web — wiring management screens

- [x] 9.1 **BREAKING** — change `UmUser.roleIds: string[]` to `roleId: string` in `lib/um-data.ts`, update `roleUserCount`, and reduce sample user `u8` to a single role
- [x] 9.2 Convert the role picker in `components/menus/um-users.tsx` from multi-select to single-select
- [x] 9.3 Wire `um-users.tsx` to `/v1/users` through `queryOptions`; mutations invalidate their key rather than calling `router.refresh()`
- [x] 9.4 Add the reset-password action to the user row, with a confirmation dialog stating that the account will be forced to set a new password on next login
- [x] 9.5 Build the account import screen following `roster-upload.tsx` — template download, `Dropzone` with `accept=".xlsx"`, progress, validation stage, results table reusing the error-row presentation, then an explicit Import action
- [x] 9.6 Show new and updated row counts separately in the preview, and list the fields each update would change before anything is committed
- [x] 9.7 Wire `um-roles.tsx` to `/v1/roles`, driving the permission matrix and scope selector from the API, and disabling controls for `locked` roles
- [x] 9.8 Wire the device registry in `components/menus/display-admin.tsx` to `/v1/devices`, including register, activate/deactivate, and pairing-link generation with a copyable link
- [x] 9.9 Surface `online` and last-seen from the API rather than the static `hb` strings

## 10. Verification

- [x] 10.1 Manually verify each seeded role: log in, confirm the sidebar matches the matrix, confirm `view` menus render without create/edit/delete controls
- [x] 10.2 Verify scope end to end for `all` and `self`; confirm a `dept` caller returns an empty set rather than unfiltered data while employee master data is absent
- [x] 10.3 Verify immediate effect: revoke a permission while a session is live and confirm the next request is refused without re-login
- [x] 10.4 Verify the API is the boundary — call a guarded endpoint directly with no session, with an insufficient grant, and with a device session, expecting 401, 403, 403
- [x] 10.5 Verify session lifetime: a web session expires 12 hours after login even while active, and after 4 hours idle; a session issued just before a shift changeover still receives its full window
- [x] 10.6 Verify the import round trip — download the template, upload it filled, confirm the preview separates new from updated rows, commit, and confirm re-uploading the same file updates rather than duplicating
- [x] 10.7 Verify an imported account can log in, is refused on every other route until it changes its password, and is admitted afterwards; verify reset-password returns it to that state
- [x] 10.8 Verify the password policy — a password under the minimum is refused, the configured default is refused as a new password, and the change-password gate stays armed through both
- [x] 10.9 Verify device pairing: pair a TV, confirm heartbeat and online status, confirm a reused link is refused, confirm deactivation ends the session
- [x] 10.10 Run the full web pipeline — `rm -rf apps/web/.next`, `bun run format`, `tsc --noEmit`, `bun run lint`, `bun run --cwd apps/web build`
- [x] 10.11 Run `bun run lint` and `bun run format:check` across the monorepo
- [x] 10.12 Update `README.md` — replace the "Auth — decide before writing more endpoints" entry under "Not done yet" with the shipped model, and add TLS termination plus the deployment target as the outstanding items that `COOKIE_SECURE` is waiting on
