## 1. Shared contracts

- [x] 1.1 Add `kode-simper` to `MENU_SLUGS` in `packages/contracts/src/access.ts`, positioned after `simper`, with the label `"Kode SIMPER"` in `MENU_LABELS`
- [x] 1.2 Add `MASTER_KINDS` — the nine catalogue kinds (`jenis-unit`, `model-unit`, `merk-unit`, `kelas-unit`, `simper`, `kode-simper`, `departemen`, `area-kerja`, `mess`) — with a `MasterKind` type and an `isMasterKind` guard mirroring `isMenuSlug`
- [x] 1.3 Add `AREA_TYPES = ["Mining", "Non Mining"]` with an `AreaType` type
- [x] 1.4 Move `TimelineAction`, `TIMELINE_ACTIONS`, and `timelineActionLabel` from `apps/web/lib/display-data.ts` into contracts, keeping all six action values and their Indonesian labels unchanged
- [x] 1.5 Move `RUNTEXT_COLORS` and `COLOR_VAL` from `apps/web/lib/display-data.ts` into contracts as the shared running-text colour vocabulary
- [x] 1.6 Confirm nothing server-only leaked in — no db client, no secrets, no node builtins — so `packages/contracts` stays browser-safe

## 2. Database schema

- [x] 2.1 Add the `area_type` pgEnum sourced from `AREA_TYPES`, and the `timeline_action` pgEnum sourced from `TIMELINE_ACTIONS`, so db, API, and client cannot drift
- [x] 2.2 Add the four name-only catalogue tables — `unit_types`, `unit_models`, `unit_brands`, `mess` — each with `id`, `name`, `active`, `created_at`
- [x] 2.3 Add the four name-plus-description catalogue tables — `unit_classes`, `simper_types`, `simper_codes`, `departments` — with the same base columns plus `description` defaulting to `""`
- [x] 2.4 Add `work_areas` with `id`, `name`, `type` (the `area_type` enum), `active`, `created_at`
- [x] 2.5 Add a unique index over `lower(name)` on every one of the nine catalogue tables — this index serves both the constraint and the case-insensitive import lookup (design D11)
- [x] 2.6 **BREAKING** — add the `units` table: `id`, `code` unique, `class_id`, `type_id`, `model_id`, `brand_id`, `simper_code_id` nullable, `department_id`, `serial`, `engine_brand`, `description`, `ftw`, `active`, `standby`, `breakdown`, `created_at`. Every catalogue reference is a FK with `onDelete: "restrict"` (design D2)
- [x] 2.7 Add `bus_schedules` — `id`, `unit_id` FK to `units` **unique**, `depart_at`, `active`, `created_at` (design D6)
- [x] 2.8 Add `run_texts` — `id`, `text`, `color`, `active`, `created_at`
- [x] 2.9 Add `device_run_texts` — `id`, `device_id` FK to `devices` cascade, `text`, `color`, `ord`, with an index on `device_id`
- [x] 2.10 Add `sounds` — `id`, `name`, `file_name` (generated, not client-supplied), `mime_type`, `size_bytes`, `active`, `created_at`
- [x] 2.11 Add `timeline_stages` — `id`, `name`, `at` (time of day), `action` (the `timeline_action` enum), `active`, `created_at`
- [x] 2.12 Export the new `$inferSelect` row types alongside the existing `RoleRow`/`UserRow`/`DeviceRow`
- [x] 2.13 Run `bun run --cwd apps/api db:generate` and commit the migration under `apps/api/drizzle/`
- [x] 2.14 Apply with `bun run --cwd apps/api db:migrate`, then confirm by hand that the case-insensitive unique index rejects `Hitachi` alongside `HITACHI`, and that deleting a referenced unit class is refused by the database

## 3. Seed and configuration

- [x] 3.1 Extend `db:seed` with the nine catalogues, transcribed from the current sample modules: 4 unit types, 9 models, 3 brands, 8 classes, 2 SIMPER permit types, the distinct SIMPER codes from `SIMPER_CODES`, 5 departments, 23 work areas with their Mining/Non Mining types, and 3 mess
- [x] 3.2 Make catalogue seeding idempotent by name, matching the existing role seed's posture
- [x] 3.3 Seed the five timeline stages (04:45 FTW deadline, 05:20 finger in, 05:21 finger ingest, 05:25 spare validate, 05:30 bus depart) and the two running texts, idempotently
- [x] 3.4 Seed the fifteen sample units resolving every catalogue reference to its seeded row — **guarded on `units` being empty**, so a database that ever held real units can never receive a sample unit (design D14)
- [x] 3.5 Add `manage` on `kode-simper` to the `superadmin` and `manpower` seed grants; confirm no other role gains a grant and no existing grant is altered
- [x] 3.6 Add `SOUND_DIR` to `apps/api/src/env.ts` and `.env.example` as explicit configuration, and document why it is not derived from `NODE_ENV`
- [x] 3.7 Report sound-storage writability in `/health` alongside `database` and `cache`, so a misconfigured directory surfaces at startup rather than at the first upload

## 4. API — master catalogues

- [x] 4.1 Add `KIND_TABLES` in `apps/api/src/routes/master.ts` mapping each `MasterKind` to its Drizzle table, its column projection, and its TypeBox response schema (design D3)
- [x] 4.2 Add per-kind response schemas to `routes/schemas.ts` — name-only, name-plus-description, and the work-area shape with its type — so the OpenAPI document names each catalogue's real fields and never exposes positional ones
- [x] 4.3 Add a `MENU_OF_KIND` map and derive each route's `auth: { menu, mode }` from the requested kind, so a grant on one catalogue never authorizes another
- [x] 4.4 `GET /v1/master/:kind` — list, with an `active` query filter; declares `params`, `query`, and `response`
- [x] 4.5 `POST /v1/master/:kind` — create; trims the name, and returns 409 through `isUniqueViolation` on a case-insensitive duplicate
- [x] 4.6 `PATCH /v1/master/:kind/:id` — update name, description or type, and active; 404 for an unknown id, 409 on duplicate
- [x] 4.7 `DELETE /v1/master/:kind/:id` — returns 409 with the referencing count when the row is still referenced, catching the FK violation rather than pre-counting in a separate query
- [x] 4.8 Reject an unknown `:kind` with 422 before any table is resolved
- [x] 4.9 Mount `masterRoutes` in `apps/api/src/index.ts` and add its OpenAPI tag

## 5. API — unit registry

- [x] 5.1 Add `UnitSchema` to `routes/schemas.ts` returning resolved catalogue **names** alongside their ids, so a list response renders without a second round trip
- [x] 5.2 `GET /v1/units` — list with joins onto the six catalogues; supports search and class/brand filters matching what `database-unit.tsx` offers today
- [x] 5.3 `GET /v1/units/:code` — single unit for the detail and edit pages; 404 when absent
- [x] 5.4 `POST /v1/units` — create; 409 on duplicate code, validation error naming the field when a catalogue reference does not resolve
- [x] 5.5 `PATCH /v1/units/:code` and `DELETE /v1/units/:code`, with delete refused by 409 while a bus schedule references the unit
- [x] 5.6 Guard every unit route with `auth: { menu: "database-unit", mode }`
- [x] 5.7 `GET`/`POST`/`PATCH`/`DELETE /v1/bus-schedules` guarded by the `bus` menu; creation restricted to units whose type is `BUS`; 409 on a second schedule for the same unit
- [x] 5.8 Mount both route groups and add their OpenAPI tags

## 6. API — display content

- [x] 6.1 `GET`/`POST`/`PATCH`/`DELETE /v1/run-texts` guarded by the `running-text` menu, validating `color` against the shared vocabulary
- [x] 6.2 `GET`/`PUT /v1/devices/:id/run-texts` guarded by the menu owning that device's kind, reusing the `MENU_OF_KIND` and `refuseUnlessOwned` helpers already in `routes/devices.ts`
- [x] 6.3 Replace the stub body of `GET /v1/display/:kind` with the effective running texts: the device's own rows when it has any, otherwise the active master rows (design D8). Keep the existing heartbeat stamp and the kind check
- [x] 6.4 `POST /v1/sounds` — multipart upload; reject non-audio MIME types and files over 2 MB with 422; generate the stored filename rather than taking the client's, and write under `SOUND_DIR`
- [x] 6.5 `GET /v1/sounds` and `PATCH`/`DELETE /v1/sounds/:id`; delete removes the stored file with the row
- [x] 6.6 `GET /v1/sounds/:id/file` — return `Bun.file(path)` so the file is never buffered into the process heap (design D7); respond 404 for an unknown sound
- [x] 6.7 Add a path-traversal test asserting that an upload named `../../etc/passwd` writes only under `SOUND_DIR`

## 7. API — allocation schedule

- [x] 7.1 `GET`/`POST`/`PATCH`/`DELETE /v1/timeline` guarded by the `timeline` menu, validating `action` against the contracts vocabulary and returning 422 for an unknown value
- [x] 7.2 Add the scheduler: a per-minute tick that reads active stages and fires those whose time has arrived
- [x] 7.3 Guard each firing with `SET NX EX` on a key scoped to stage id and date, so exactly one process fires and a restart inside the same minute does not double-fire (design D9)
- [x] 7.4 Add the action hook table: `ftw-deadline`, `finger-in`, `bus-depart`, and `other` log and return; `finger-ingest` and `spare-validate` log and return with a documented comment marking them as the allocation engine's attachment point
- [x] 7.5 Record every firing so the outcome is observable without a UI
- [x] 7.6 Define and implement the behaviour for a stage whose time is edited to a moment already passed today, so dispatch stays deterministic and never repeats
- [x] 7.7 Add an integration test running two API processes against one Redis and asserting exactly one dispatch per stage per day

## 8. API — import and export

- [x] 8.1 Add a per-kind column mapper: the spreadsheet columns each catalogue and the unit registry accept, used by both export and import so an export round-trips
- [x] 8.2 `GET /v1/master/:kind/export` and `GET /v1/units/export` — generate the spreadsheet; guarded by `view` on the owning menu
- [x] 8.3 `POST /v1/master/:kind/import/preview` and the unit equivalent — parse, resolve catalogue references case-insensitively and trim-insensitively, classify each row as new, changed, or failed, and **write nothing**
- [x] 8.4 Report failed rows in the existing error shape (`row`, `nik`, `emp`, `issue`, `badgeVariant`, `badge`) so the results table matches the account and roster imports
- [x] 8.5 Report per-row field changes for updated rows, as `users-import.ts` does, so the caller sees what would change before approving
- [x] 8.6 `POST /v1/master/:kind/import` and the unit equivalent — commit inside **one transaction per file**, so a partial application is impossible (design D10)
- [x] 8.7 Guard preview and commit with `manage` on the owning menu
- [x] 8.8 Confirm an unresolvable catalogue value fails its row and never creates the named catalogue record

## 9. Web — query layer and master menus

- [x] 9.1 Add `lib/queries/master.ts` with a `masterQueryOptions(kind)` factory and its key, following `devices.ts`'s shape
- [x] 9.2 Add `lib/queries/units.ts`, `lib/queries/bus-schedules.ts`, `lib/queries/run-texts.ts`, `lib/queries/sounds.ts`, and `lib/queries/timeline.ts`
- [x] 9.3 **BREAKING** — rewrite `components/menus/master.tsx`: replace `Entry`'s positional `a`/`b`/`c` with per-kind field names resolved through `colsFor`, and replace `React.useState(SAMPLE[cat])` with `useQuery`
- [x] 9.4 Wire create, edit, and delete to `useMutation`; invalidate the affected key on success rather than calling `router.refresh()`
- [x] 9.5 Surface the API's message on a rejected mutation — 409 on a case-insensitive duplicate, 409 with the referencing count on a refused delete — and leave the list unchanged
- [x] 9.6 Add the `kode-simper` leaf to the Master group in `lib/nav.ts` and its entry in `registry.tsx`; keep `simper` where it is
- [x] 9.7 Drive the sound row's play button and the dialog's preview from `GET /v1/sounds/:id/file`; wire the file input to a real multipart upload with the 2 MB and audio-type limits surfaced before submission
- [x] 9.8 Drive the timeline dialog's action select from the contracts vocabulary, submitting the action **value** rather than its label
- [x] 9.9 Render write controls only for `manage`, keeping the API as the actual boundary

## 10. Web — database unit and bus

- [x] 10.1 Wire `components/menus/database-unit.tsx` to `/v1/units`, with search and the class/brand filters served by the API
- [x] 10.2 Wire `components/menus/unit-form.tsx` — every catalogue dropdown reads its `masterQueryOptions(kind)`; submitting sends catalogue ids, not names
- [x] 10.3 Wire the unit detail and edit pages under `app/(app)/database-unit/[code]`
- [x] 10.4 Replace the simulated import progress dialog with the real preview-then-commit flow, reusing the results presentation from the roster and account imports
- [x] 10.5 Wire the export button through `fetchBlob`, not Eden — Eden mangles a binary body into replacement characters (`lib/api.ts:22`)
- [x] 10.6 Wire the Bus menu to `/v1/bus-schedules`, offering only units of type `BUS`, and rendering the empty state when none exist

## 11. Web — display admin and kiosk

- [x] 11.1 Wire the running-text section of `components/menus/display-admin.tsx` to `/v1/devices/:id/run-texts`, keeping the "empty means follow master" semantics visible in the UI
- [x] 11.2 Wire `app/display/_components/running-ticker.tsx` to `GET /v1/display/:kind`, replacing `runTextsForDisplay`
- [x] 11.3 Have each of the four kiosk pages under `app/display/` poll its display endpoint, so `last_seen_at` is stamped and devices stop reading `Offline · belum pernah`
- [x] 11.4 Drive ticker colours from the contracts colour vocabulary rather than the local `COLOR_VAL`

## 12. Web — retire the static data modules

- [x] 12.1 **BREAKING** — delete `lib/unit-data.ts`, `lib/area-data.ts`, and `lib/departemen-data.ts`, and remove the master half of `lib/display-data.ts`, keeping only what the still-static display admin needs
- [x] 12.2 Re-point `components/menus/fleet-setting.tsx` — work areas, digger units, non-digger units, bus units, and the unit type label all come from queries
- [x] 12.3 Re-point `components/menus/employees-form.tsx` — departments, mess, SIMPER permit types, and SIMPER qualification codes come from queries; the mess dropdown becomes Mess A/B/C and block becomes a separate text input (design D5)
- [x] 12.4 Re-point the department filters in `components/menus/employees.tsx` and `components/menus/attendance.tsx`
- [x] 12.5 Grep for any remaining import of the deleted modules and confirm none survives
- [x] 12.6 Confirm `components/menus/unit-status.tsx` is untouched — it carries its own data

## 13. Verification

- [x] 13.1 Verify each catalogue end to end: create, edit, deactivate, and delete; confirm a deactivated row disappears from selection lists while remaining in its own screen and leaving existing references intact
- [x] 13.2 Verify case-insensitive uniqueness — `Hitachi` is refused while `HITACHI` exists — and that the stored casing is preserved as typed for `Panel East Puncak Utara`
- [x] 13.3 Verify referential protection: deleting a unit class that units reference returns 409 with the count, and no unit is altered
- [x] 13.4 Verify catalogue renames propagate — rename a class and confirm every referencing unit displays the new name with no per-unit update
- [x] 13.5 Verify per-menu authorization: a caller with `manage` on `kelas-unit` and no grant on `departemen` is refused on departments; a `view`-only caller sees no write controls and is refused by the API independently
- [x] 13.6 Verify `kode-simper` is separate from `simper`: a unit's qualification requirement selects from qualification codes only, and a permit type cannot be set as one
- [x] 13.7 Verify the unit round trip: create a unit through the form, confirm it appears in Fleet Setting's unit selections without a redeploy
- [x] 13.8 Verify the import path — export a catalogue, re-import it unchanged and confirm zero new, zero changed, zero errors; then corrupt one catalogue value and confirm that row is reported by number and no catalogue record is created
- [x] 13.9 Verify commit atomicity by forcing a failure partway through a commit and confirming nothing from that file remains applied
- [x] 13.10 Verify sound upload, playback, size and MIME rejection, and that deleting a sound removes its file; confirm a traversal-style filename writes only under `SOUND_DIR`
- [x] 13.11 Verify display fallback: a device with its own texts shows those, a device with none shows the active master texts, and removing a device's last text restores the fallback
- [x] 13.12 Verify the heartbeat now works — open a kiosk, confirm the device reports online in the registry, and confirm it no longer reads `Offline · belum pernah`
- [x] 13.13 Verify the scheduler: a stage fires once at its time, an inactive stage does not fire, and two processes against one Redis produce exactly one dispatch
- [x] 13.14 Verify the seed is safe to re-run: run `db:seed` twice on a fresh database and confirm no duplicates; run it against a database holding a real unit and confirm no sample unit is inserted
- [x] 13.15 Verify the migration path for an existing installation: run the seed against a database seeded before `kode-simper` existed and confirm `superadmin` and `manpower` gain the grant while no other grant changes
- [x] 13.16 Run the full web pipeline — `rm -rf apps/web/.next`, `bun run format`, `tsc --noEmit`, `bun run lint`, `bun run --cwd apps/web build`
- [x] 13.17 Run `bun run lint` and `bun run format:check` across the monorepo
- [x] 13.18 Update `README.md` — remove the "A paired TV never reports in" entry under "Not done yet", narrow the "every other menu is still a static design port" note to the menus that remain static, and document `SOUND_DIR` and the persistent volume it implies alongside the existing TLS caveat
