## Why

Every menu in the Master group is still a static design port: thirteen screens
render arrays from `apps/web/lib/*-data.ts`, and every create, edit, and delete
is a toast that disappears on refresh. Nothing an operator types survives a page
reload.

That is not merely an unfinished screen. Master data is what the allocation
engine matches against — a unit's class and SIMPER code decide which spare may
take it, and the morning timeline decides _when_ that matching runs. Those
values live today as free text typed into a form with no catalogue behind it, so
a single mistyped SIMPER code silently removes a unit from every spare's
candidate list with no error anywhere. Authentication and RBAC already landed and
gave every one of these menus a slug and a grant; the tables they were meant to
guard do not exist yet.

## What Changes

### Master catalogues

- Nine lookup catalogues become database tables with CRUD behind `/v1/master/*`:
  `unit_types`, `unit_models`, `unit_brands`, `unit_classes`, `simper_types`,
  `simper_codes`, `departments`, `work_areas`, `mess`.
- **BREAKING** — `SIMPER` splits in two. The existing `simper` menu keeps its
  real meaning, permit type (`F` Full permit / `P` Probation). A **new
  `kode-simper` menu** owns the qualification catalogue (`EXC 2600`, `OHT 777`)
  that the allocation engine matches spares against, and that today has no owner
  at all — it is derived with `SELECT DISTINCT` over a free-text unit column.
- Names are stored trimmed and are unique **case-insensitively**, so `Hitachi`
  can no longer coexist with `HITACHI` as two different brands.
- Deleting a catalogue row that is still referenced is refused with 409, the
  same posture `users.role_id` already takes.

### Unit registry

- **BREAKING** — `units` becomes a table, and its class, type, model, brand,
  SIMPER code, and department become **foreign keys** rather than the free text
  they are today. A value that is not in a catalogue can no longer be saved.
- `bus_schedules` gives a bus unit its departure time. A bus is not an
  independent entity — it is a unit of type `BUS` with a time attached.

### Display content

- Running texts become rows, with a **per-device override**: a display shows its
  own texts if it has any, and falls back to the master list if it has none.
- Sounds gain real upload. Files are stored on the API's filesystem and streamed
  with `Bun.file`, never buffered through Postgres.
- `GET /v1/display/:kind` stops returning a stub and serves the effective
  running texts for the calling device. Because that route already stamps
  `last_seen_at`, the kiosks begin reporting their heartbeat as a side effect —
  closing the README's "a paired TV never reports in, so it always reads
  Offline".

### Allocation schedule

- Timeline stages become rows, and `TimelineAction` moves into
  `@universe/contracts` so the database, the API, and the client cannot drift.
- A scheduler fires each stage at its configured time, guarded by a Redis lock
  so multiple API processes do not double-fire. `finger-ingest` and
  `spare-validate` resolve to logged no-op hooks: the allocation engine does not
  exist yet, and this change gives it the trigger to attach to, not the work.

### Import and export

- The stub import/export buttons on every master screen become real, following
  the preview-then-commit shape `users-import.ts` already established: upload,
  see what would be created and changed and which rows are wrong, then approve.
- With foreign keys in place, an import row naming a catalogue value that does
  not exist is rejected **by row number** instead of silently creating one.

### Static data removal

- **BREAKING** — `lib/unit-data.ts`, `lib/area-data.ts`, `lib/departemen-data.ts`
  and the master half of `lib/display-data.ts` are deleted. Their consumers —
  `fleet-setting`, `employees`, `employees-form`, `attendance`, and the kiosk
  ticker — read the API instead, so a value added in a master menu appears
  everywhere immediately even where the surrounding screen is still sample data.

## Capabilities

### New Capabilities

- `master-data` — the nine lookup catalogues: shape, uniqueness, active
  semantics, referential protection, and per-menu authorization.
- `unit-registry` — the `units` table, its foreign keys into the catalogues, and
  `bus_schedules`.
- `display-content` — running texts with per-device override, sound storage and
  delivery, and what a kiosk receives from `GET /v1/display/:kind`.
- `allocation-schedule` — timeline stages, the shared action vocabulary, and the
  scheduler that fires them.
- `master-import` — spreadsheet export and the preview-then-commit import across
  every master category.

### Modified Capabilities

- `rbac` — `MENU_SLUGS` gains `kode-simper`, so the seeded grants change:
  `superadmin` covers 31 slugs rather than 30, and `manpower` 23 rather than 22.
  No other requirement changes; the enforcement model is unchanged.

## Impact

**`packages/contracts`** — `MENU_SLUGS`/`MENU_LABELS` gain `kode-simper`;
`TIMELINE_ACTIONS`, `RUNTEXT_COLORS`, and `AREA_TYPES` are added. Must stay
browser-safe.

**`apps/api`** — fifteen new tables and their migration; routes under
`/v1/master/*`, `/v1/units`, `/v1/bus-schedules`, `/v1/run-texts`, `/v1/sounds`,
`/v1/timeline`; `GET /v1/display/:kind` gains real content; a scheduler process
and a Redis lock; a new `SOUND_DIR` environment variable and the persistent
volume it implies; `db:seed` extended.

**`apps/web`** — thirteen Master menus and `display-admin` wired to TanStack
Query; four static data modules deleted and five further menus re-pointed at the
API; four kiosk pages under `app/display/` begin calling the API.

**Deferred** — `employees` still has no table, so `employees.dept_id`,
`mess_id`, and the skill join wait for their own change. The catalogues those
keys will point at are created here, so that change is additive.

**Operational** — sound files require a persistent directory on the API host. On
an ephemeral container it must be mounted as a volume or uploaded sounds are
lost on redeploy.
