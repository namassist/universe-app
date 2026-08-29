# Database schema — orientation

Source of truth is `src/db/schema.ts` (Drizzle). This document is the map, not
the definition — when they disagree, the code wins. Change flow: edit
`schema.ts` → `bun run db:generate` → `bun run db:migrate`; never hand-edit
`drizzle/` SQL or `drizzle/meta/`.

## Entity groups

**Identity & access**

- `roles`, `role_permissions` — the RBAC matrix as data: role × menu ×
  access_mode (`view`/`manage`) × scope (`all`/`dept`/`self`). Seeded, edited
  from the UM menus.
- `users` — login accounts. Linked to an employee by **NIK** (string), not by
  FK id — see known-issues: renaming an employee's NIK orphans the account.
- `devices` — kiosk displays (all four kinds) with their own auth.

**Master data catalogues** (spreadsheet-importable)

- Units: `unit_types`, `unit_brands`, `unit_models`, `unit_classes`
- SIMPER (operator skill licences): `simper_types`, `simper_codes`
- Organisation: `departments`, `work_areas`, `companies`, `positions`, `mess`

**People**

- `employees` — the personnel record (photo on disk under `PHOTO_DIR`, path in
  the row), status, department, position, mess, blood type, MCU result.
- `employee_skills` — employee × SIMPER code; what units they may operate.

**Fleet**

- `units` — the machines; keyed by unit code, classed and typed via the
  catalogues. PLAN pairing of operators to units.
- `bus_schedules` — crew transport schedule.
- `fleets` — a digger and its work area; the digger reference is unique (a
  digger leads at most one fleet) and _is_ the fleet's identity — no name
  column. Optional `bus_unit_id` (route-enforced type BUS); `work_area_id`
  route-enforced type Mining.
- `fleet_units` — the fleet's haulers; `unit_id` unique across the table, so
  a unit hauls for at most one fleet. Rows cascade with their fleet.
- `unit_status_history` — append-only trail of status changes with mandatory
  reasons. Current status stays _derived_ from `units.breakdown`/`standby`
  (breakdown wins); this table answers "since when, and why".
- `fleet_plan_slots` — the standing PLAN pairings. `employee_id` unique (an
  operator holds one unit); max-2-per-unit and the Day/Night pair rule are
  route-enforced (they need the roster, which the table cannot see).

**Roster** (monthly, imported from spreadsheet)

- `roster_documents` — one upload per month × department; approval state.
- `roster_days` — the per-employee per-day shift codes (`roster_code` enum).
- `roster_revisions`, `roster_revision_items` — post-approval corrections as
  explicit revision records, never silent edits.

**Displays & schedule**

- `run_texts`, `device_run_texts`, `sounds` — kiosk content (sound files on
  disk under `SOUND_DIR`).
- `timeline_stages` — the editable timeline, acted on by the scheduler.
  **Two halves**, because FTW and fingerprint are required on both shifts: the
  day's (04:45 FTW deadline + ingest, 05:15 finger-in deadline + ingest, 05:25
  spare validation, 05:30 bus) and the night's, the same six twelve hours later
  (16:45 / 17:15 / 17:25 / 17:30). `shift` (`day | night`, nullable) is what
  tells two rows carrying the same action apart — the alternative, comparing
  their clock times, is the same answer derived worse. Null means the stage
  governs neither shift in particular, which is what an `other` marker is.
- `fingerprint_machines` — the fingerprint machines on site: name, `ip`
  (**unique** — the address is the machine's identity, and what a reachability
  probe will dial), `active`. Owned here rather than read from Nakula's
  `tbl_m_absen_to_finger`, which still lists machines dead since early 2026.
  Deactivating, not deleting, is the move for a machine that is merely
  unplugged. Seeded from `seed-master.ts` keyed on IP, so an operator's rename
  survives a re-seed. Carries the prober's reading too — `online`,
  `last_seen_at` (last contact), `checked_at` (last attempt), `status_since`
  (when the current status began, so a screen can say how long) and
  `miss_count`, the persisted debounce counter.

**Readiness snapshots** (external sources, ingested)

- `ftw_readings` — per person per day: savera's fit-to-work verdict (sleep
  minutes, sleep category, FTW decision as _text_ — their rules are
  operator-configurable), plus the org snapshot savera reported. Unique
  `(nik, date)`, upserted by the ingest.
- `finger_readings` — per person per day: first IN and first OUT tap with
  device IPs, raw as the machines recorded them. Interpretation (which tap
  means presence for which shift) belongs to the consumer, not the snapshot.
- Both deliberately have **no FK to `employees`**: the snapshot must not drop
  people this system has no record for. NIKs are normalized (digits-only, no
  leading zeros); timestamps are source-local strings, never timezone-shifted.

## Enums

`access_mode`, `scope`, `roster_code`, `employee_status`, `blood_type`,
`mcu_result`, `area_type`, `device_kind`, `timeline_action`, `unit_status` —
all Postgres enums in `schema.ts`, with values from `@universe/contracts`.

## Conventions

- Detect duplicate-key errors with `isUniqueViolation(error, "constraint")`
  from `src/db` — never `error.code` (Drizzle wraps the driver error).
- Files never go in Postgres: rows hold paths, bytes live under the storage
  dirs and stream via `Bun.file`.
- Seeds: `bun run db:seed` (idempotent), `db:seed:fresh` resets. Master-data
  seed lives in `seed-master.ts`.
