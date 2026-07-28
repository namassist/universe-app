## MODIFIED Requirements

### Requirement: Seeded roles reproduce the established access matrix

The system SHALL seed six roles — `superadmin`, `admin`, `manajer`, `manpower`,
`medic`, `user` — with the permissions and scopes established for the product.
The seed MUST be idempotent.

#### Scenario: Superadmin

- **WHEN** the seed runs
- **THEN** `superadmin` SHALL hold `manage` on all 33 menu slugs, SHALL have scope `all`, and SHALL be `locked`

#### Scenario: Admin

- **WHEN** the seed runs
- **THEN** `admin` SHALL have scope `dept`, `manage` on `employees`, `roster-data`, `roster-revision`, and `attendance`, and `view` on `dashboard`, `display-attendance`, `display-fleet`, `fit-to-work`, `unit-status`, `fleet-allocation`, and `fleet-setting`

#### Scenario: Manajer

- **WHEN** the seed runs
- **THEN** `manajer` SHALL have scope `dept`, `manage` on `roster-approval` only, and `view` on the other eleven menus of its remit

#### Scenario: Manpower

- **WHEN** the seed runs
- **THEN** `manpower` SHALL have scope `all` and `manage` on all 25 menus of its remit, including every master-data menu — `kode-simper`, `perusahaan`, and `jabatan` among them — and `setting`, with no `view`-only grants

#### Scenario: Medic

- **WHEN** the seed runs
- **THEN** `medic` SHALL have scope `all`, `manage` on `fit-to-work`, and `view` on `dashboard`, `display-attendance`, `display-fleet`, `display-fitwork`, and `employees`

#### Scenario: User

- **WHEN** the seed runs
- **THEN** `user` SHALL have scope `self`, `manage` on `fit-to-work`, and `view` on `dashboard`, `employees`, `roster-data`, `roster-revision`, and `attendance`

#### Scenario: Re-running the seed

- **WHEN** the seed runs against a database that already contains the six roles
- **THEN** it SHALL complete without error and SHALL NOT duplicate roles or permission rows

#### Scenario: Seeding a new menu slug into an existing installation

- **WHEN** the seed runs against a database seeded before `kode-simper` existed
- **THEN** `superadmin` and `manpower` SHALL gain `manage` on `kode-simper`, no other role SHALL gain a grant, and no existing grant SHALL be altered or removed

#### Scenario: Seeding the company and position slugs into an existing installation

- **WHEN** the seed runs against a database seeded before `perusahaan` and `jabatan` existed
- **THEN** `superadmin` and `manpower` SHALL gain `manage` on both slugs, no other role SHALL gain a grant, and no existing grant SHALL be altered or removed

### Requirement: Scope filters returned data

The caller's scope SHALL constrain which records the API returns and mutates,
across employees, roster, revisions, attendance, Fit To Work, units, fleet
allocation, and dashboard aggregates.

A `dept`-scoped caller's departemen SHALL be resolved through the employee
record its NIK identifies, and SHALL be compared as a department reference
rather than as a department name.

#### Scenario: All scope

- **WHEN** a caller whose scope is `all` lists a scoped collection
- **THEN** the API SHALL return records across every departemen

#### Scenario: Dept scope

- **WHEN** a caller whose scope is `dept` lists a scoped collection
- **THEN** the API SHALL return only records belonging to the departemen of the employee record the caller's NIK identifies

#### Scenario: Dept scope resolves through the employee record

- **WHEN** a `dept`-scoped caller whose NIK matches an employee lists a scoped collection
- **THEN** the API SHALL return that employee's departemen's records, and SHALL NOT return an empty set

#### Scenario: Dept scope that cannot be resolved

- **WHEN** a `dept`-scoped caller's departemen cannot be determined, because no employee record matches its NIK
- **THEN** the API SHALL return an empty set and SHALL NOT return the unfiltered collection

#### Scenario: Self scope

- **WHEN** a caller whose scope is `self` lists a scoped collection
- **THEN** the API SHALL return only records belonging to that caller's own NIK

#### Scenario: Self scope on the employee collection

- **WHEN** a caller whose scope is `self` lists employees
- **THEN** the API SHALL return only the employee record whose NIK matches the caller's

#### Scenario: Dashboard aggregates respect scope

- **WHEN** a caller requests dashboard figures
- **THEN** the aggregates SHALL be computed over the same record set the caller's scope permits, not over the whole site

## ADDED Requirements

### Requirement: The menu slug list covers the company and position catalogues

The shared contracts SHALL define `perusahaan` and `jabatan` menu slugs
governing the company and position catalogues.

Adding them SHALL be additive: permission records referencing existing slugs
SHALL remain valid, and a role with no grant on either slug SHALL simply have no
access to it.

#### Scenario: The new slugs are accepted

- **WHEN** a permission is submitted granting a mode on `perusahaan` or `jabatan`
- **THEN** the API SHALL persist it, since the slugs are defined in the contracts package

#### Scenario: Existing grants are unaffected

- **WHEN** the slug list is widened
- **THEN** every existing permission record SHALL remain valid and SHALL continue to resolve to the same menu

#### Scenario: A role without the grant has no access

- **WHEN** a caller whose role holds no grant on `jabatan` requests the position catalogue
- **THEN** the API SHALL respond 403
