## Why

The `add-roster` work needed a company to own a department and a department to
own a position — a mining operator's roster row means nothing until you know
which company's mining department it belongs to, and two companies each run a
`MINING OPERATION`. So the chain was built and shipped in `f30bbf1`, together
with the fleet-allocation flag the shift allocator will read and the write
scoping a department admin needs to manage their own people.

None of it is in a spec. `master-data` still describes departments and positions
as flat catalogues whose names are unique installation-wide, which is not merely
incomplete — it is the opposite of what the database now enforces. This change
closes that gap: it is retrospective, and its job is to make the specs describe
the shipped system so the next reader is not misled.

## What Changes

- **BREAKING** — catalogue name uniqueness for departments and positions moves
  from global to per-parent. `(company, lower(name))` for departments,
  `(department, lower(name))` for positions. Under the old single global index
  there could be exactly one `ADMIN` and one `MINING OPERATION` in the whole
  installation; the requirement as written forbade the organisation the customer
  actually has.
- A company carries a **code** (`UDU`, `RBS`) unique without regard to case,
  alongside its name and description.
- A department **belongs to a company**; a position **belongs to a department**.
  Both references are required and both refuse deletion of a parent that still
  has children.
- A position carries **`fleetAllocation`**, a boolean marking whether people in
  that position enter fleet allocation. It is not derived from the position's
  name or its department.
- A record's **parent is fixed at creation**. An edit may change the name,
  description, code, and flags; it may not move a department to another company
  or a position to another department, because that silently re-files every
  employee filed under it.
- **Import identity becomes the parent path plus the name.** The `departemen`
  sheet carries a `perusahaan` column, the `jabatan` sheet carries `perusahaan`
  and `departemen`, and a row matches an existing record on the whole path — not
  on the name alone, which would read a same-named record under a different
  owner as an edit and move it.
- **An unresolved parent is refused, not offered for creation.** A row naming a
  company or department that does not exist fails with a message saying which
  one, rather than joining the pending-additions list. Creating a parent as a
  side effect of a child row is how a typo becomes a second organisation.
- **An employee's company, department, and position must form one chain.** The
  employee row keeps its own `companyId` rather than deriving it, and the route
  checks that the department belongs to that company and the position to that
  department, naming the field that broke.
- **A department-scoped caller may write, bounded by their scope.** Create takes
  the department from the caller's own employee record and ignores the body;
  edit, delete, and photo resolve the target through the scope predicate and
  answer 404 — not 403 — when it is out of scope; import refuses a row on either
  side of the pairing.
- **A NIK rename carries the account holding it**, in the same transaction, and
  is refused with 409 when another account already holds the new NIK.
- The web master screens filter by parent, show the fleet flag, disable the
  parent selector on edit, and label the `jabatan` menu **Posisi** while the slug
  stays `jabatan`.

## Capabilities

### New Capabilities

None. Every requirement here belongs to a catalogue, an import target, or an
employee record that an existing capability already owns. A separate
`organisation-chain` spec would have to restate `master-data`'s uniqueness rule
in order to contradict it, and two specs disagreeing about the same index is the
failure this change exists to fix.

### Modified Capabilities

- `master-data`: the eleven catalogues gain a hierarchy — a company code, a
  department's company, a position's department and fleet flag; name uniqueness
  becomes per-parent; a parent cannot be reassigned by edit; deletion refusal
  counts child catalogue records as well as employees; the master screens gain
  parent filters and the `jabatan` menu is labelled Posisi.
- `master-import`: the `departemen` and `jabatan` sheets gain parent columns; a
  row's identity is its parent path and its name; an unresolved parent is
  refused rather than offered for creation; the employee sheet resolves
  department through company and position through department.
- `employee-data`: company, department, and position must form one chain and the
  route names which link failed; every write is bounded by the caller's scope,
  with creation taking the department from the caller and out-of-scope targets
  answering 404; a NIK rename carries the account holding it.

## Impact

**Database** — `companies.code`; `departments.company_id`;
`positions.department_id`; `positions.fleet_allocation`. Migrations
`0005_rich_donald_blake.sql` (hand-written: nullable, backfill, `SET NOT NULL`,
because the generated `ADD COLUMN … NOT NULL` fails on a table with rows) and
`0006_supreme_natasha_romanoff.sql`. The old global `lower(name)` indexes on
`departments` and `positions` are replaced by composite ones — existing rows
attach to the alphabetically first parent, which is arbitrary because the old
schema recorded no ownership at all.

**API** — `src/db/schema.ts`, `src/routes/master.ts`, `src/routes/schemas.ts`,
`src/routes/master-import.ts`, `src/routes/employees.ts`,
`src/db/seed-master.ts`, `src/db/seed.ts` (and the `db:seed:fresh` script).

**Contracts** — `master-import.ts` (`MASTER_IMPORT_COLUMNS`,
`MASTER_IMPORT_PARENT_COLUMNS`), `access.ts` (the `jabatan` label).

**Web** — `components/menus/master.tsx`, `components/menus/employees-form.tsx`,
`lib/queries/master.ts`.

**Docs** — the two entries in `docs/known-issues.md` that this behaviour closed.

**Not affected** — `roster_days` and `roster_revision_items` reference
`employees.id`, a uuid, so roster history is untouched by any of this, including
a NIK rename.
