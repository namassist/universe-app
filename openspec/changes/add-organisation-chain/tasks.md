## 0. Read this first

This change is **retrospective**. The chain, the fleet flag, and the employee
write scoping shipped in `f30bbf1`; the specs are being written after the code
rather than before it. So most tasks below are verification — read the code, run
the check, confirm the spec sentence is true of the system as it stands — and a
task that fails verification becomes real work.

The genuinely outstanding work is concentrated in group 6: several spec scenarios
have no committed test, and two were verified once by a scratch script that was
deleted. Those are the tasks that will take time.

- [ ] 0.1 Read `design.md` D1–D13 before starting; each task below names the decision it verifies

## 1. Schema and migration

- [ ] 1.1 Confirm `companies.code` is `NOT NULL` and `companies_code_lower_idx` is unique over `lower(code)` (D2)
- [ ] 1.2 Confirm `departments.company_id` and `positions.department_id` are `NOT NULL` with `onDelete: "restrict"` (D1)
- [ ] 1.3 Confirm the global `lower(name)` unique indexes on `departments` and `positions` are gone, and `departments_company_name_lower_idx` and `positions_department_name_lower_idx` exist in their place (D2)
- [ ] 1.4 Confirm `positions.fleet_allocation` is `NOT NULL DEFAULT false` (D4)
- [ ] 1.5 Confirm `0005_rich_donald_blake.sql` runs nullable → backfill → `SET NOT NULL`, and that its comment states the backfill is arbitrary and why (D11)
- [ ] 1.6 Verify the migration pair applies cleanly to a database restored from before them, and that an empty parent table with a non-empty child fails at `SET NOT NULL` rather than inventing a parent (D11)
- [ ] 1.7 Confirm the doc comment in `schema.ts` explains why `employees.company_id` stays its own column rather than becoming a composite foreign key (D3)

## 2. Catalogue routes

- [ ] 2.1 Confirm `POST /:kind` requires the parent for `departemen` and `jabatan`, and answers 422 naming the field when it does not resolve (`parentExists`)
- [ ] 2.2 Confirm `PATCH /:kind/:id` declares no parent field, and that an edit carrying one returns 200 with the parent unchanged (D5)
- [ ] 2.3 Confirm `catalogueRows` and `catalogueMap` are parent-qualified, so no code path identifies a department or position by bare name (D2)
- [ ] 2.4 Confirm the delete refusal counts departments for a company and positions for a department, and that the message names them
- [ ] 2.5 Confirm `MasterCompanySchema`, `MasterDepartmentSchema`, and `MasterPositionSchema` are declared **first** in the `MasterRecordSchema` union, and that the comment says the order is load-bearing
- [ ] 2.6 Confirm the position catalogue response carries `fleetAllocation` and the company response carries `code`

## 3. Import

- [ ] 3.1 Confirm `MASTER_IMPORT_COLUMNS` gives `perusahaan` a `kode` column, `departemen` a `perusahaan` column, and `jabatan` both ancestors plus `alokasi_fleet`
- [ ] 3.2 Confirm `MASTER_IMPORT_PARENT_COLUMNS` names the ancestor columns for both hierarchical kinds, and that `packages/contracts` still imports nothing from the db or node builtins
- [ ] 3.3 Confirm `existingKeyOf` is used for the `current` lookup, so a row matches on `company|department|name` and never on the name alone (D6)
- [ ] 3.4 Confirm an unresolved company or department refuses the row with a message naming the ancestor, and never joins the pending-additions list (D7)
- [ ] 3.5 Confirm a blank parent column refuses the row, and that nothing inherits a parent from the row above
- [ ] 3.6 Confirm the employee parse resolves department by `company|department` and position by `company|department|position`, with an explanatory refusal on either mismatch
- [ ] 3.7 Confirm `employeeTarget`'s `restrictTo` checks both sides of the pairing — the row's department and the department the named NIK currently belongs to (D8)
- [ ] 3.8 Confirm the employee import's existing-NIK lookup is still unscoped, and that the comment explains why refusing requires resolving (D9)

## 4. Employee routes

- [ ] 4.1 Confirm `writeScope` resolves through the caller's NIK and fails closed when it resolves to nobody (D8)
- [ ] 4.2 Confirm `POST /` takes the department from the caller's own record for a scoped caller and never reads the body's placement (D8)
- [ ] 4.3 Confirm `PATCH`, `DELETE`, and `POST /:nik/photo` resolve the target through `scopeWhere` and answer 404, not 403 (D8)
- [ ] 4.4 Confirm `PATCH` returns nothing for an out-of-scope target — the old disclosure hole (D8)
- [ ] 4.5 Confirm `mismatchedOrganisation` names which link failed rather than reporting a constraint, and runs on create, edit, and both import paths (D3)
- [ ] 4.6 Confirm a NIK rename writes `employees` and `users` in one transaction, calls `invalidateUser`, and answers 409 `nik_taken` on collision — including the raced case landing in the same handler (D13)

## 5. Web and seeder

- [ ] 5.1 Confirm the department screen filters by company and the position screen by department, with `enabled` rather than a conditional hook
- [ ] 5.2 Confirm a position row is labelled with its company and department together, since a department name alone is not unique (D2)
- [ ] 5.3 Confirm the parent selector is disabled on edit and states why (`t.mdParentLocked`)
- [ ] 5.4 Confirm the fleet flag renders as a column and is editable in the dialog, using design tokens only — no arbitrary colour
- [ ] 5.5 Confirm `MENU_LABELS.jabatan` reads `Posisi` while the slug, route path, permission row, and import column heading all still read `jabatan` (D10)
- [ ] 5.6 Confirm the employee form derives its department options from the selected company and disables both selectors for a scoped caller
- [ ] 5.7 Confirm `ORGANISATION` declares both companies with every department the customer named, that every department has an `ADMIN` position, and that `db:seed:fresh` refuses to run under `NODE_ENV=production` (D12)
- [ ] 5.8 Confirm `seedUnits` resolves its department company-qualified via `departmentKey`, and that `seedAccounts` throws rather than skipping when a cross-cutting position is missing from the tree

## 6. Tests for the scenarios that have none

- [ ] 6.1 Add a test that two companies can each hold a `MINING OPERATION` and two departments can each hold an `ADMIN`, and that a duplicate within one parent still answers 409 (D2 — the requirement this change exists to correct, currently untested)
- [ ] 6.2 Add a test that a department returned by the API still carries `companyId`, guarding the union order in `MasterRecordSchema` against a broader member matching first
- [ ] 6.3 Add a test that deleting a company with departments, and a department with positions, answers 409 with a count naming them
- [ ] 6.4 Add a test that an edit carrying a parent field leaves the parent unchanged (D5) — this pins behaviour that comes from Elysia's `normalize` default rather than from our own code, so a framework upgrade should break the test and not the guarantee
- [ ] 6.5 Commit a round-trip test for the three owned catalogues — export, re-import, expect unchanged and zero errors — replacing the scratch script that verified it once and was deleted
- [ ] 6.6 Add a test that an import row naming a position that exists under a different department is reported as a new record, not as an edit (D6 — the silent-move bug)
- [ ] 6.7 Add a test that a `dept`-scoped caller's employee import refuses rows for other departments (D8), which `employees-scope.test.ts` covers for the single-record routes but not for the sheet
- [ ] 6.8 Run `bun test` in `apps/api` in full and fix the fallout, checking test teardown deletes positions → departments → companies in that order

## 7. Close out

- [ ] 7.1 Run `bunx openspec validate add-organisation-chain --strict` and `bun run lint`, `bun run format:check`, and `tsc --noEmit` across the workspace — not `next build`, which corrupts `apps/web/.next` while the dev server is running
- [ ] 7.2 Update `openspec/specs/master-data/spec.md`'s Purpose paragraph if the chain makes the phrase "lookup catalogues" misleading — the sync will not do this for you
- [ ] 7.3 Note in `docs/known-issues.md` that the two closed entries are now covered by requirements, so a future reader can find the spec rather than only the defect
