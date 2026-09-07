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
fleet — single-site scale does not need one yet.

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

## Known debt

- `users` links to employees by NIK string; renaming a NIK orphans the
  account and dept/self scope goes silently blind (`docs/known-issues.md`
  at the repo root).
- TLS undecided (blocks real accounts); Redis unauthenticated in dev.
