## Context

The thirteen menus in the Master group are the last large block of the web app
that is still a static design port. Twelve of them render through a single
generic component, `components/menus/master.tsx`, which flattens every category
into one row shape:

```ts
type Entry = {
  id: string;
  name: string;
  a: string;
  b: string;
  c?: string;
  active: boolean;
};
```

`a` and `b` mean something different per category — description in `kelas-unit`,
type in `area-kerja`, time and action in `timeline`. The thirteenth,
`database-unit`, is a genuine entity with fourteen columns and its own
`/new`, `/[code]`, and `/[code]/edit` pages. All of them read arrays from
`lib/unit-data.ts`, `lib/area-data.ts`, `lib/departemen-data.ts`, and
`lib/display-data.ts`, and all of their mutations are toasts.

Three of the twelve are not master data at all. `running-text` and `sound` are
display content shared with the kiosk pages under `app/display/`; `timeline` is
the morning allocation schedule, whose `action` values name work the allocation
engine is supposed to perform. They ride the same component because the design
port needed a table with a dialog, not because they share a domain.

What already exists and constrains this change:

- **RBAC is real and enforced per route.** Every master menu already has a slug
  in `MENU_SLUGS` and a grant in the seeded roles, and `requireAuth` in
  `apps/api/src/auth/macro.ts` gates on `{ menu, mode }`. No new authorization
  machinery is needed — only route declarations.
- **`devices` is the only display-side table.** It holds identity and
  `last_seen_at`. `GET /v1/display/:kind` stamps the heartbeat but returns a
  stub, with a comment saying content configuration is deliberately out of
  scope. The seam was left open on purpose.
- **`employees` has no table.** `schema.ts` holds `roles`, `role_permissions`,
  `users`, and `devices` only. The `dept` scope in RBAC resolves through
  `users.nik → employees.nik → employees.dept`, a chain that is broken today.
- **The data-fetching pattern is settled.** `queryOptions` in `lib/queries/*`,
  server prefetch plus hydration, mutations invalidate rather than refresh.
  `routes/devices.ts` and `routes/users-import.ts` are the CRUD and the
  spreadsheet-import templates respectively.

## Goals / Non-Goals

**Goals:**

- Persist every master catalogue and make the Master menus read and write the
  API instead of module-scope arrays.
- Give the allocation engine a trustworthy vocabulary to match against: a real
  catalogue of SIMPER qualification codes, and units that reference it by key
  rather than by typed string.
- Make the master catalogues the single source of truth everywhere they appear,
  including in screens whose own data is still sample.
- Turn the timeline into configuration that actually fires, with a documented
  place for the allocation engine to attach.
- Replace the stub import/export buttons with a flow that refuses bad rows by
  number rather than absorbing them.

**Non-Goals:**

- **The allocation engine itself.** The scheduler fires `finger-ingest` and
  `spare-validate` as logged no-ops. Matching spares to units, generating
  ACTUAL from PLAN, and ingesting fingerprint data are separate work.
- **The `employees` table.** Its foreign keys into `departments`, `mess`, and
  `simper_codes` are anticipated by this design but not created. See D13.
- **Fleet Setting, Unit Status, Attendance, Roster as features.** Their master
  dropdowns are re-pointed at the API; their own records stay sample data.
- **Fit To Work and fingerprint ingestion.** Owned by external apps; untouched.
- **TLS and deployment target.** Still open, and `SOUND_DIR` inherits that
  openness (see Risks).

## Decisions

### D1 — One table per catalogue, not one polymorphic table

A single `master_entries(kind, name, a, b, c, active)` table would have made
this change small: one migration, one route, and `master.tsx` would barely
change, since its row shape is already exactly that.

It is rejected because of D2. A foreign key into a polymorphic table constrains
nothing that matters: `units.class_id → master_entries.id` is satisfied just as
well by a row whose `kind` is `departemen`. The database would accept a unit
whose class is a department, and the only thing standing between that and
production would be handler code — which is precisely the guarantee a foreign
key exists to remove from handler code.

Two lesser reasons reinforce it. Positional columns named `a`, `b`, and `c`
would appear verbatim in the generated OpenAPI document, which is the artifact a
future mobile client generates from; a client author would have to read the web
app to learn that `a` means "description" for classes and "type" for work areas.
And per-category constraints — `work_areas.type` restricted to Mining/Non
Mining, `unit_classes.description` non-null — become handler conventions rather
than schema, checked only on the paths someone remembered to check.

The cost is nine near-identical Drizzle table definitions. That cost is paid once
in `schema.ts` and does not propagate: D3 keeps the route surface and the web
component generic anyway.

**Alternative considered:** table-per-catalogue plus a database `VIEW` unioning
them for the generic list endpoint. It reintroduces the positional-column
problem at the API boundary while adding a view to maintain, and buys nothing
that D3 does not already buy.

### D2 — Units reference catalogues by foreign key, with `ON DELETE RESTRICT`

`units` stores its class, type, model, brand, SIMPER code, and department as
free text today. Those become `class_id`, `type_id`, `model_id`, `brand_id`,
`simper_code_id`, and `department_id`, each a foreign key with `ON DELETE
RESTRICT`.

Without keys, a master catalogue is a list of suggestions for a dropdown, and
the truth stays in whatever string the unit row happens to hold. Three failures
follow directly, and all three are silent:

- Renaming `BIGDIGGER` leaves forty units pointing at a class that no longer
  exists, and nothing reports it.
- Deleting a class that forty units use succeeds, and the units keep a dangling
  label.
- A spreadsheet import writes `BIGDIGER` into forty rows, and the misspelling is
  discovered when those units stop being allocated.

The last one is the reason this matters more here than in a typical CRUD app.
The product's stated target is zero unit downtime at shift start; a unit whose
SIMPER code matches no operator's qualification simply never gets an operator,
and the failure surfaces as an idle machine rather than as an error.

`RESTRICT` over `CASCADE` follows the precedent already set for
`users.role_id` — a role in use cannot be deleted, and the API answers 409 with
the count of accounts holding it. The same shape applies here: attempting to
delete a catalogue row still referenced returns 409 naming how many units
reference it. `SET NULL` is wrong for the same reason it would be wrong for
roles: a unit with no class is not a meaningful record.

**Alternative considered:** keep text and add a nightly reconciliation job that
reports orphans. It converts a constraint the database can enforce for free into
a report someone has to read, and it cannot prevent the bad write in the first
place.

### D3 — Per-category tables, but one generic route and one generic component

D1 multiplies tables; it does not have to multiply routes or React components.

The API exposes `/v1/master/:kind` with `kind` validated against a
`MASTER_KINDS` union. A `KIND_TABLES` map inside `routes/master.ts` resolves the
kind to its Drizzle table, its column projection, and its TypeBox response
schema, so the handler body is written once. Response schemas remain per-kind —
`work_areas` declares a `type` field and `unit_classes` a `description` field —
so the OpenAPI document stays honest even though one handler serves all of them.

On the web, `MasterMenu` keeps its current structure: one component, a
`colsFor(cat)` table of column definitions, one dialog. What changes is where
rows come from and what saving does — `useQuery` and `useMutation` replace
`React.useState(SAMPLE[cat])`. The `a`/`b`/`c` positional fields are replaced by
real field names per category, resolved through the same `colsFor` map.

This is the compromise that makes D1's cost bounded: schema-level correctness
without schema-level repetition anywhere above the schema.

### D4 — SIMPER splits into two catalogues; the new one is `kode-simper`

The word SIMPER names two different things in the current code, and only one of
them has a menu:

|                    | Meaning                             | Values                          | Owner today                                     |
| ------------------ | ----------------------------------- | ------------------------------- | ----------------------------------------------- |
| Permit type        | May this person drive at all        | `F` Full permit, `P` Probation  | the `simper` master menu                        |
| Qualification code | Which units may this person operate | `EXC 2600`, `OHT 777`, `DT R12` | nothing — `SELECT DISTINCT` over `units.simper` |

The second is the one the product is built on. `employees.simper.skills[]` holds
these codes, `units.simper` holds one, and matching them is what decides whether
a spare may take an empty unit. It is derived from a free-text column, which
means the catalogue's contents are a consequence of what someone typed into a
unit form.

D2 makes leaving it derived impossible anyway: `units.simper_code_id` cannot
reference a `SELECT DISTINCT`. So the qualification catalogue becomes
`simper_codes`, with its own menu slug **`kode-simper`** and label **"Kode
SIMPER"** — the term the existing code comments already use
(`employees-data.ts:10`, "kode_simper unit yang dikuasai"). The existing `simper`
menu keeps its slug and its meaning, permit type.

Adding a menu slug is a code change plus a seed, exactly as `access.ts` intends;
it touches `MENU_SLUGS`, `MENU_LABELS`, `lib/nav.ts`, `registry.tsx`, and
`db/seed.ts`.

**Alternatives considered.** _One table with a `tipe` discriminator_ avoids a new
slug, but it puts two unrelated vocabularies in one table and one screen, and
`units.simper_code_id` would then need a check constraint to stop it referencing
a permit type — the polymorphic problem of D1 in miniature. _Renaming the
existing slug_ so that `simper` becomes the qualification catalogue is the
clearest naming, but it changes a slug that seeded `role_permissions` rows
already reference, turning a seed edit into a data migration for no functional
gain.

### D5 — Mess is one level; block and room stay free text

The master lists `Mess A`, `Mess B`, `Mess C`, while employees pick from
`Mess A — Blok 1`, `Mess A — Blok 2` and separately carry a `kamar` field. So
housing is really three levels: mess, block, room.

Only the first becomes a table. `employees.mess_id` will reference it when
employees land (D13); block and room remain free text on the employee record.

The rationale is that blocks carry no attributes and participate in no matching
— nothing in the allocation model reads a block. Modelling them would add a
table, a menu, a slug, and a grant to gain validation of a string that is only
ever displayed. Room is already free text and no one has asked otherwise.

The visible consequence is in `employees-form.tsx`: the mess dropdown becomes
Mess A/B/C, and block becomes a separate text input rather than being baked into
the same string.

**Alternative considered:** one table with `(mess, block)` columns and a
composite unique. It gets validated blocks without a second table, but it
repeats "Mess A" on every row, and the master screen for it lists blocks rather
than messes — which is not what the menu is called.

### D6 — Bus is a schedule attached to a unit, not an entity

A bus row in the current design is a unit code chosen from units whose type is
`BUS`, plus a departure time. It has no other content, and the list is empty
today because no `BUS` unit exists yet.

So `bus_schedules(unit_id UNIQUE → units, depart_at, active)`. The menu keeps
working the way it looks: pick a bus unit, set a time. `UNIQUE` on `unit_id`
because a bus has one departure time; a second row for the same unit is a 409,
not a second schedule.

**Alternative considered:** a nullable `depart_at` column on `units`. It avoids a
table, but adds a column to a 500–1000-row table that is null for all but a
handful of rows, and it gives the bus menu nothing to write to that is not also
writable from the unit form. `fleet_settings.bus` (still sample data) references
a bus by code, and will reference `units` when Fleet Setting is wired — a
separate table keeps that reference pointing at the schedule rather than at a
column that may or may not be filled.

### D7 — Sound files live on the API filesystem, streamed with `Bun.file`

Sounds are the only master data with a binary payload. Today the `.wav` files
sit in `apps/web/public/sounds/` and `soundSrc()` builds a static path; the
dialog's file input creates an object URL for preview and uploads nothing.

Files go to a directory on the API host, configured as `SOUND_DIR`, with the
`sounds` row holding the stored filename, MIME type, and byte size. Playback is
`GET /v1/sounds/:id/file` returning `Bun.file(path)`.

Postgres `bytea` was the initial recommendation because it needs no persistent
volume and rides the database backup. It is rejected on cost per request: a
`bytea` read pulls the whole blob across the database connection into the Bun
process's heap before a single byte reaches the client, and Postgres de-TOASTs
it on every read. `Bun.file` is a lazy handle — the file never enters the
process's memory, and after the first read the OS page cache serves it with no
syscall into the runtime at all. For a payload played on a schedule from several
kiosks at once, that difference is the whole decision.

Uploads are capped (2 MB) and restricted to audio MIME types, and the stored
filename is generated rather than taken from the client, so an upload named
`../../etc/passwd` writes nowhere interesting.

The trade-off is a persistent directory — see Risks.

### D8 — Running texts have a per-device override with fallback to master

A display shows its own configured texts if it has any, and the master list if
it has none. That is the behaviour the current static helper already implements
(`runTextsForDisplay`, `display-data.ts:222`) and it is preserved exactly.

`run_texts` holds the master list. `device_run_texts(device_id → devices, text,
color, ord)` holds per-device overrides. `GET /v1/display/:kind` resolves the
effective list for the calling device: override rows if the device has any,
otherwise active master rows.

Persisting only the master half would have left `runTextsForDisplay` mixing a
live source with a dead one — master from the API, overrides from a module-scope
array — which is worse than either end of the choice.

Two things follow that are worth naming. `display-admin` (outside the Master
group) gets wired to the API, because that is where overrides are edited. And
the four kiosk pages begin calling `GET /v1/display/:kind`, which stamps
`last_seen_at`; the README's standing complaint that every paired TV reads
`Offline · belum pernah` resolves without any heartbeat-specific work, because
the missing piece was always a caller rather than a feature.

### D9 — Timeline stages fire, guarded by a Redis lock; actions are hooks

`timeline_stages(name, at, action, active)` persists the schedule, and
`TimelineAction` moves from `apps/web/lib/display-data.ts` into
`@universe/contracts` so the database enum, the TypeBox schema, and the client
all derive from one list — the same discipline `SCOPES` and `DEVICE_KINDS`
already follow.

A scheduler in the API wakes each minute, reads the active stages, and fires
those whose time has arrived. Firing is guarded by `SET NX EX` on a Redis key
scoped to the stage and the date, so with several API processes exactly one
fires, and a process restart inside the same minute does not double-fire.

The actions themselves resolve to a hook table. `ftw-deadline`, `finger-in`,
`bus-depart`, and `other` are markers and log. `finger-ingest` and
`spare-validate` name real work that does not exist yet; they resolve to logged
no-ops with a single documented extension point.

Building the trigger before the work it triggers is deliberate. The alternative
— persist the rows now, add firing when the engine lands — means the engine's
change has to design the scheduler, the locking, and the shared action
vocabulary on top of its own complexity. Landing the mechanism against no-ops
makes the engine's change an implementation of two functions.

The honest cost is that a scheduler that fires nothing observable is hard to
prove correct from the UI; it is verified by log assertions and by a test that
runs two processes against one Redis and asserts a single fire.

### D10 — Import follows preview-then-commit; foreign keys make it strict

`routes/users-import.ts` already established the shape: upload, receive a
preview of what would be created and updated plus a per-row error list, approve,
then write. Master imports reuse it — one preview route and one commit route per
kind, both generic over the `KIND_TABLES` map, with a per-kind column mapper.

D2 changes what an import can do. A row naming `BIGDIGER` cannot be written,
because there is no such class to key against. Rather than creating one — which
is how a text column would behave, and how a catalogue silently fills with
typos — the row is rejected and reported with its number, reusing the existing
error-row shape (`row`, `nik`, `emp`, `issue`, `badge`) so the results table
renders identically to the roster and account imports.

Matching is case-insensitive and trim-insensitive per D11, so a spreadsheet
whose casing differs from the catalogue still imports. Only genuine mismatches
fail.

Commit runs in one transaction per file. A partially applied import of a
thousand units is worse than a rejected one, because the operator cannot tell
which half landed.

Export goes through `fetchBlob` rather than Eden — `lib/api.ts` already
documents why: Eden decodes an unrecognised body as text and mangles every
invalid UTF-8 byte, so a spreadsheet downloads and then refuses to open.

### D11 — Names are trimmed on write and unique case-insensitively

Every catalogue name is `.trim()`ed on write, as `devices.ts` already does, and
carries a unique index over `lower(name)`.

Case-insensitive uniqueness rather than exact uniqueness: `Hitachi` and
`HITACHI` as two brands is a data-entry accident in every case, and once both
exist, half the units point at one and half at the other. Storing the name as
typed rather than normalising to upper case preserves readability where it
matters — `Panel East Puncak Utara` and `Mining Operation` are Title Case in the
existing data, while unit classes and brands are upper case, and forcing one
convention across both would make the work-area list shout.

The same comparison is used for import matching (D10), which is what lets a
spreadsheet with different casing import cleanly while a real misspelling fails.

### D12 — The static data modules are deleted, and their consumers move to the API

`lib/unit-data.ts`, `lib/area-data.ts`, `lib/departemen-data.ts`, and the master
half of `lib/display-data.ts` are removed. Five files outside the Master group
read them and are re-pointed at `lib/queries/*`:

| File                                     | Reads                                                                                   | Becomes                    |
| ---------------------------------------- | --------------------------------------------------------------------------------------- | -------------------------- |
| `fleet-setting.tsx`                      | `AREA_MINING_NAMES`, `DIGGER_UNITS`, `FLEET_MEMBER_UNITS`, `BUS_UNITS`, `unitTypeLabel` | work-area and unit queries |
| `employees-form.tsx`                     | `DEPARTEMEN_NAMES`, `MESS_OPTS`, `SIMPER_TYPES`, `SIMPER_CODES`                         | four catalogue queries     |
| `employees.tsx`                          | `DEPARTEMEN_NAMES`                                                                      | department query           |
| `attendance.tsx`                         | `DEPARTEMEN_NAMES`                                                                      | department query           |
| `display/_components/running-ticker.tsx` | `COLOR_VAL`, `runTextsForDisplay`                                                       | `GET /v1/display/:kind`    |

These screens keep their own sample data; only their master-derived dropdowns
and filters change. Leaving them static would create two sources of truth with
no mechanism keeping them aligned, and the symptom would be a user adding a work
area in the master menu and never seeing it in Fleet Setting — which reads as a
bug in the master menu.

`unit-status.tsx` carries its own data and is untouched.

### D13 — `employees` is deferred, and this change is what makes it additive

Employees have no table. `employees.dept_id`, `mess_id`, and a
`employee_skills` join into `simper_codes` all follow from D2 and D4, and all of
them wait.

Deferring is possible precisely because the direction of reference runs the
right way: employees will point at catalogues, not the reverse. Creating the
catalogues first means the employee change adds columns and a join table to a
schema whose targets already exist, with no rework here.

What stays broken until then is the `dept` scope in RBAC, which resolves through
`users.nik → employees.nik → employees.dept`. It is broken today and this change
neither fixes nor worsens it.

### D14 — The seed carries the full sample set, but units only into an empty table

`db:seed` gains all nine catalogues, the timeline stages, and the fifteen sample
units with their serial numbers, so that the application after migration looks
exactly as it does now.

Catalogue rows are genuine reference data for the site — five departments,
twenty-three work areas, eight unit classes — and seeding them is
straightforwardly right. The fifteen units are sample records with invented
serial numbers, and seeding those into a production database is not.

The reconciliation: catalogue seeding is idempotent by name, as the role seed
already is. Unit seeding is guarded on the table being **empty**. A first
`db:seed` on a fresh developer database produces the full picture; a `db:seed`
re-run against a database that already holds real units adds nothing. The guard
is on emptiness rather than on per-row existence, so a production database that
was ever populated can never receive a sample unit, even if every sample code
happens to be absent.

## Risks / Trade-offs

**Sound files need a persistent directory (D7)** → `SOUND_DIR` is explicit
configuration, like `COOKIE_SECURE`, rather than derived from `NODE_ENV`. On an
ephemeral container it must be a mounted volume or uploaded sounds vanish on
redeploy. Documented in the README's deployment section alongside the existing
TLS caveat, and the health check reports the directory as writable so a
misconfiguration surfaces at startup rather than at the first upload.

**A scheduler that fires no-ops cannot be proven from the UI (D9)** → verified by
log assertion and by an integration test running two API processes against one
Redis, asserting exactly one fire per stage per day. The hook table is the
documented extension point, so the allocation engine's change implements two
functions rather than designing a scheduler.

**Backfilling `units` from text to keys (D2)** → the fifteen sample units are the
only existing data and the seed rewrites them, so there is no production
backfill in this change. When real units arrive by import, unmatched values are
rejected by row (D10) rather than silently coerced. The risk is deferred to the
import path, where it is visible.

**Deleting four static modules touches five unrelated screens (D12)** → those
screens' own behaviour does not change; only the source of their dropdown
options does. Each is covered by the verification pipeline, and the change is
mechanical enough to review file by file. The alternative — two sources of truth
— has no bounded cost at all.

**`kode-simper` widens `MENU_SLUGS` (D4)** → an additive slug, so existing
`role_permissions` rows stay valid and roles that should not see it simply have
no grant. Only `superadmin` (31 slugs) and `manpower` (23) change in the seed;
the seed is idempotent and adds the grant to existing installations.

**Thirteen menus, fifteen tables, and a scheduler in one change** → real, and
accepted deliberately: splitting it would mean shipping foreign keys before the
catalogues they point at, or catalogues that nothing references. The task
ordering below is arranged so tasks 1–3 are already a working product and
everything after is additive, giving reviewable stopping points inside one
change.

**Case-insensitive uniqueness is not free at scale (D11)** → the unique index is
over `lower(name)` and is used for both the constraint and the import lookup, so
the index that enforces correctness is the one that serves the hot path. At a
few hundred catalogue rows this is not measurable either way.

## Migration Plan

The ordering matters: each step leaves the application running.

1. **Contracts, schema, migration, seed.** `kode-simper` added; `TIMELINE_ACTIONS`,
   `RUNTEXT_COLORS`, `AREA_TYPES` moved in; fifteen tables created; seed
   extended. Nothing in the UI changes yet — the web app still reads its arrays.
2. **Catalogue routes.** `/v1/master/:kind` for all nine catalogues, and the
   `kode-simper` menu appears. Master menus wired. At this point the nine lookup
   screens are real.
3. **Units.** `units` and `bus_schedules` with their keys; `database-unit`, its
   form pages, and the bus menu wired. Master dropdowns now serve real data.
4. **Display content.** `run_texts`, `device_run_texts`, `sounds`;
   `GET /v1/display/:kind` returns effective content; `display-admin` and the
   kiosk pages wired. Device heartbeats begin.
5. **Scheduler.** `timeline_stages` firing under the Redis lock, actions as
   hooks.
6. **Import and export.** Preview-then-commit across every kind; the stub
   buttons become real.
7. **Static removal.** The four data modules deleted and their five consumers
   re-pointed.

**Rollback.** Steps 2–7 are additive at the database level and revert by
deploying the previous build. Step 1 contains the only destructive element — the
`units` shape — and reverts by the down migration plus a re-seed, which is
lossless while units are still sample data. After real units are imported,
rollback past step 3 requires a database restore, which is the point at which
this change stops being reversible by deployment alone.

## Open Questions

- **Does a work area's Mining/Non Mining type belong in the database as an enum
  or as a catalogue of its own?** Modelled here as a Postgres enum sourced from
  `AREA_TYPES` in contracts, on the assumption the two values are structural
  rather than editable. If sites turn out to add types, it becomes a catalogue —
  an additive change.
- **Should deactivating a catalogue row hide it from dropdowns while leaving
  existing references intact?** Assumed yes throughout: `active: false` removes
  a row from selection lists but never invalidates a unit already pointing at
  it. Confirm against how the site actually retires a unit class.
- **Is one departure time per bus unit correct (D6)?** `UNIQUE` on `unit_id`
  assumes so. If a bus runs both shifts, the constraint becomes
  `(unit_id, shift)` — additive, but worth confirming before real data exists.
- **What is the retention story for sound files whose row is deleted?** Assumed
  the file is removed with the row. An orphan-sweep job is not included; if
  deletion should be soft, the file must survive and the sweep becomes real work.
