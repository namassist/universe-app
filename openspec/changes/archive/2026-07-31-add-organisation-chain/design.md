## Context

The master catalogues were built flat: eleven kinds, each a table of names with
one `lower(name)` unique index, served by one generic route parameterised on the
kind. That shape carried the platform through `add-master-data` and
`add-employee-data` because nothing needed to know which company a department
belonged to — the employee row named a company and a department independently and
nobody checked they agreed.

`add-roster` broke that. A roster document belongs to a department for a month,
and the customer runs two companies — PT Unggul Dinamika Utama (UDU) and PT
Rezeki Borneo Sebuku (RBS) — each with its own `MINING OPERATION` and each
requiring an `ADMIN` position. Under a single global name index those are not
two records, they are a 409. The organisation the customer has was literally
unrepresentable.

The chain, the fleet flag, and the employee write scoping shipped in `f30bbf1`.
This design records the decisions behind that code so the specs it accompanies
can be read as intentional rather than incidental.

Constraints in force throughout: TypeBox schemas stay in `apps/api` and never
leak into `@universe/contracts`, which must stay browser-safe; every route
declares `body`, `params`, and `response`; every route re-checks session,
permission, and scope independently, because the web proxy and the shell are user
experience and not the boundary.

## Goals / Non-Goals

**Goals:**

- Make company → department → position a relationship the database enforces, not
  a convention the routes hope for.
- Let two companies hold same-named departments, and two departments hold
  same-named positions, without either colliding.
- Give the shift allocator an explicit signal for which positions enter fleet
  allocation, decided by whoever manages the catalogue.
- Let a department-scoped admin manage their own people without letting them
  reach, or learn about, anyone else's.
- Keep the generic catalogue route generic — one handler, parameterised, no
  per-kind handlers.

**Non-Goals:**

- Depth beyond three levels. No sub-departments, no position hierarchy, no
  reporting lines. A fourth level would want a recursive table and this is not
  that.
- Moving a department between companies, or a position between departments, as a
  supported operation. See D5.
- Deriving fleet allocation from anything. See D4.
- Renaming the `jabatan` menu slug, permission row, or spreadsheet column. Only
  the label the user reads changes. See D10.
- Reworking how `employees.company_id` is stored. See D3.

## Decisions

### D1 — Enforce the chain in the schema, not only in the routes

`departments.company_id` and `positions.department_id` are `NOT NULL` foreign
keys with `onDelete: "restrict"`.

_Alternative considered:_ keep the catalogues flat and validate the pairing in
application code wherever it matters. Rejected because "wherever it matters"
turned out to be the employee route, both employee import paths, the roster
template, the roster import, and the seeder — six places to keep in step, each
able to drift on its own, none of them able to stop a direct `INSERT`. The
relationship is a fact about the data, so the data holds it.

### D2 — Uniqueness moves per parent; it does not merely gain a column

`departments_company_name_lower_idx` on `(company_id, lower(name))` and
`positions_department_name_lower_idx` on `(department_id, lower(name))` replace
the global `lower(name)` indexes. `companies` keeps its global name index and
gains `companies_code_lower_idx` on `lower(code)`.

This is the load-bearing half of D1. Adding a parent column while keeping the
global index would have satisfied the foreign key and still refused the second
`MINING OPERATION`. The requirement that changed is not "departments have a
company" but "a department's name is unique within its company" — which is why
`master-data`'s uniqueness requirement is MODIFIED rather than merely extended.

The cost is that a name no longer identifies a record. Everything that used to
look a department up by name now needs the company too — the seeder's unit
fixtures (hence `departmentKey(companyCode, name)`), the import (D6), and every
test fixture.

### D3 — The employee row keeps its own `company_id`

An employee names a company, a department, and a position as three separate
references, and the route checks that the department belongs to the company and
the position to the department.

_Alternative considered:_ drop `employees.company_id` and derive the company
through the department. Rejected: the company is read on nearly every employee
query and on the roster export, and deriving it turns each into a join for a
value that never differs.

_Alternative considered:_ a composite foreign key from
`(department_id, company_id)` to `departments`. Rejected: Postgres requires the
referenced columns to carry a unique constraint, so this would force a redundant
unique key on `departments(id, company_id)` — `id` is already the primary key —
purely to satisfy the reference. And a constraint violation names the constraint,
not the field; the route's own check can say _which_ link broke, which is what
the caller needs to fix the row.

The trade-off is honest: the pairing is enforced in the route rather than the
database, so a direct `INSERT` can produce an employee whose department belongs
to another company. Accepted, because every path that writes an employee goes
through that route.

### D4 — `fleetAllocation` is stored, not derived

`positions.fleet_allocation` is a boolean defaulting to false, set per position
by whoever manages the catalogue.

_Alternative considered:_ derive it from the department (everything under
`MINING OPERATION` allocates) or from the name (anything matching `OPERATOR`).
Both rejected. The department is wrong at the edges — a mining department has
clerks and a pit-service department has fuel-truck drivers who do allocate — and
name matching makes a spreadsheet typo change who gets a unit at shift start.
The person who knows which positions sit on a unit is the person managing
positions, so the field is theirs.

### D5 — A parent is set at creation and never reassigned by an edit

`POST` accepts and requires the parent. `PATCH` does not declare it, so Elysia's
`normalize` — on by default — strips it from the body before the handler runs.
The handler cannot write a parent because it never sees one, which is a stronger
guarantee than a handler that reads the field and chooses to ignore it.

It is _not_ a validation failure: an edit carrying `companyId` returns 200 with
the parent unchanged, verified against a minimal Elysia app rather than assumed.
Whether that should instead be a 422 — telling a client its intent was dropped —
is left open below; the difference is a message, not an exposure.

Moving a department to another company re-files every employee, every roster
document, and every position under it in one unaudited write. If that is ever
needed it should be an explicit transfer operation that says what it is about to
move and how many rows it touches — not a side effect of the same dialog used to
fix a spelling.

### D6 — Import identity is the parent path plus the name

`ImportTarget` gained `existingKeyOf`, so a row finds its counterpart by
`company|department|name` rather than by name alone.

Without it, D2's consequence becomes a data-loss bug: a `jabatan` sheet row for
`ADMIN` under `UDU / HRM` would match the `ADMIN` under `RBS / HRM` by name, and
the import would report it as an edit. The preview would say "1 updated" and the
commit would move a position — and every employee filed under it — to another
department. Silent, plausible, and confirmed by the caller.

### D7 — An unresolved parent refuses the row; it is never offered for creation

A `departemen` row naming a company that does not exist, or a `jabatan` row
naming a department that does not exist under the named company, fails with a
message identifying which one. It does not join the pending-additions list.

Pending additions exist so a leaf value — a unit model, a work area — can be
added from a sheet that legitimately introduces it. A company is not a leaf
value. Creating one because a child row misspelled it produces a second
organisation that looks real, and the rows that named it correctly now live in a
different tree from the rows that did not.

### D8 — A department-scoped caller writes, bounded, and out-of-scope reads 404

Reads were already scoped. Writes were not: a `dept`-scoped holder of `manage`
on `employees` could create into another department and edit, delete, or
re-photograph anyone whose NIK they knew.

The spec was silent rather than violated, so the silence was the decision. Either
`manage` on `employees` was for `all`-scoped holders only, or a department admin
manages their own people. **Decided: their own people** — the seeded `admin` role
is scoped `dept` and carries `employees: manage`, and reading that grant as
unusable would make the role matrix say one thing and mean another.

Mechanically:

- **Create** takes the department from the caller's own employee record and the
  company from that department, exactly as a roster upload resolves its own. The
  body's values are not corrected — they are never read.
- **Edit, delete, photo** resolve the target through `scopeWhere` and answer
  **404**, matching `GET /:nik`, rather than 403. An existence answer that
  differs for records outside the caller's department is a register they can
  enumerate one NIK at a time. This also closes the older hole where `PATCH`
  returned the updated record unscoped — a write was a way to read.
- **Edit** reads the department and company from the record as it stands for a
  scoped caller, so a transfer cannot be smuggled in as a field edit.

### D9 — The employee import's existing-NIK lookup stays unscoped on purpose

The `current` map for an employee import is built without the scope predicate,
and the row is refused afterwards.

It reads backwards and it is deliberate: a NIK the caller cannot see has to
_resolve_ in order to be refused. Scope the lookup and the row reads as a new
employee, passes preview, and collides with `employees_nik_unique` mid-commit —
turning a clear refusal into a transaction failure the caller cannot act on.
What the caller learns is that the NIK is taken, which the unique index would
have told them anyway.

### D10 — The `jabatan` rename is a label, not an identifier

`MENU_LABELS.jabatan` becomes `"Posisi"`. The slug stays `jabatan` because it
names a route path, a `role_permissions` row in every existing installation, and
a column header in every spreadsheet already distributed. Renaming it would
require a migration, a contracts change, and a re-issue of the templates, to
change a word the API never shows anyone.

### D11 — The migration is nullable, backfill, `SET NOT NULL`

`drizzle-kit` emitted `ADD COLUMN … NOT NULL`, which fails on any table holding
rows. The migration was rewritten by hand in three steps.

The backfill is arbitrary and cannot be otherwise: the old schema recorded no
ownership, so there is no correct answer to recover. Existing departments attach
to the alphabetically first company and existing positions to the alphabetically
first department; a company's code is seeded from its own row id as a
placeholder. If a parent table is empty while its child is not, the column stays
NULL and `SET NOT NULL` fails — loudly, on purpose, rather than inventing a
parent.

### D12 — Development data is wiped and reseeded rather than migrated

`SEED_FRESH=1 bun run db:seed:fresh` deletes the workforce in
reference-graph-reverse order and reseeds from `ORGANISATION`. It refuses to run
under `NODE_ENV=production` and it preserves the superadmin account.

D11's backfill is defensible as a migration but worthless as data — a department
under the wrong company is a wrong answer that looks like a right one. In
development the honest move is to throw it away. The seeder builds 2 companies,
14 departments, 48 positions and 168 people from a declared tree, so the shape is
reproducible and reviewable in one file.

### D13 — A NIK rename carries the account in the same transaction

`users.nik` is a plain unique text column with no foreign key to
`employees.nik` — deliberately, per auth D5 and employee D2, because accounts
and employee records have different lifetimes. So nothing updated it and
Postgres raised nothing: renaming an employee left the account pointing at
nobody, and a `dept`- or `self`-scoped holder went silently blind on every
screen because `scopeWhere` fails closed.

The rename now writes both rows in one transaction and invalidates the cached
principal, so the next request re-reads the NIK its scope resolves through. A
rename onto a NIK another account holds is refused 409 `nik_taken`, with
`users_nik_unique` catching the race the check cannot see and landing in the same
handler.

## Risks / Trade-offs

**The backfill produces plausible-looking wrong data** → D12 wipes and reseeds in
development, and no production installation exists yet. If one did, the migration
would need a manual mapping supplied per installation, not this backfill.

**The pairing is enforced in the route, not the database (D3)** → every write
path goes through the route, and `employees-scope.test.ts` covers both sides of
the pairing. A direct SQL write can still produce a mismatched employee; that is
the accepted cost of not adding a redundant unique key.

**A name no longer identifies a catalogue record (D2)** → the import keys on the
path (D6) and the seeder's unit fixtures resolve company-qualified. The residual
risk is in code not yet written: anything that looks a department up by bare name
will now find the wrong one or nothing. Tests were the thing that caught this
last time, and there are eighteen of them that did.

**`MasterRecordSchema` union order is load-bearing** → a department row also
satisfies `MasterDescribedSchema`, and TypeBox matches the first member that
validates, so a department matched as described-only would be returned with
`companyId` stripped. The three chained schemas are declared first. This is a
correctness dependency on declaration order, which is fragile; it is called out
in the file rather than left to be rediscovered.

**404 for an out-of-scope target is indistinguishable from a typo (D8)** → an
admin mistyping a NIK sees "not found" rather than "not yours". Accepted: the
alternative discloses the existence of every employee in the installation, one
NIK at a time, and the screens a department admin uses only ever list their own
people anyway.

**`users.nik` still has no foreign key (D13)** → the transaction is the only
thing keeping the two rows in step, so a direct SQL rename re-opens the original
defect. Recorded in `docs/known-issues.md` with the symptom, because the failure
mode — every screen empty, no error — reads as missing master data rather than as
a broken link.

## Migration Plan

1. `0005_rich_donald_blake.sql` — add `companies.code`, `departments.company_id`,
   `positions.department_id` as nullable; backfill per D11; `SET NOT NULL`; drop
   the global `lower(name)` indexes on `departments` and `positions`; create the
   composite ones and `companies_code_lower_idx`.
2. `0006_supreme_natasha_romanoff.sql` — add `positions.fleet_allocation`
   defaulting to false.
3. `bun run db:seed:fresh` in development, per D12.

**Rollback:** the composite indexes drop cleanly and the global ones can be
recreated only if no duplicate pair exists — that is, only before the customer's
actual organisation has been entered. After that the schema change is one-way,
which is the honest consequence of D2 rather than an oversight: the data the new
schema permits cannot be represented by the old one.

## Open Questions

- Should moving a department between companies exist as an explicit transfer
  operation (D5)? Not needed yet; if it is, it wants its own change with an audit
  record of what it moved.
- Should an edit that carries a parent field answer 422 rather than 200 with the
  field stripped (D5)? Stripping is safe but silent, and a third-party client
  would have no way to learn its transfer did not happen. Turning `normalize` off
  for this route would also start refusing every other unknown field, which is a
  wider change than the question deserves.
- Does the shift allocator want more than a boolean from `fleetAllocation` — a
  unit class or a qualification code per position, so the pool can be narrowed
  before matching? That belongs to `allocation-schedule`, not here.
