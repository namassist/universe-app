## MODIFIED Requirements

### Requirement: Seeded roles reproduce the established access matrix

The system SHALL seed six roles — `superadmin`, `admin`, `manajer`, `manpower`,
`medic`, `user` — with the permissions and scopes established for the product.
The seed MUST be idempotent.

#### Scenario: Superadmin

- **WHEN** the seed runs
- **THEN** `superadmin` SHALL hold `manage` on all 31 menu slugs, SHALL have scope `all`, and SHALL be `locked`

#### Scenario: Admin

- **WHEN** the seed runs
- **THEN** `admin` SHALL have scope `dept`, `manage` on `employees`, `roster-data`, `roster-revision`, and `attendance`, and `view` on `dashboard`, `display-attendance`, `display-fleet`, `fit-to-work`, `unit-status`, `fleet-allocation`, and `fleet-setting`

#### Scenario: Manajer

- **WHEN** the seed runs
- **THEN** `manajer` SHALL have scope `dept`, `manage` on `roster-approval` only, and `view` on the other eleven menus of its remit

#### Scenario: Manpower

- **WHEN** the seed runs
- **THEN** `manpower` SHALL have scope `all` and `manage` on all 23 menus of its remit, including every master-data menu — `kode-simper` among them — and `setting`, with no `view`-only grants

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

## ADDED Requirements

### Requirement: The menu slug list covers the qualification catalogue

The shared contracts SHALL define a `kode-simper` menu slug governing the SIMPER
qualification catalogue, distinct from the existing `simper` slug governing
permit types.

Adding it SHALL be additive: permission records referencing existing slugs SHALL
remain valid, and a role with no grant on `kode-simper` SHALL simply have no
access to it.

#### Scenario: The new slug is accepted

- **WHEN** a permission is submitted granting a mode on `kode-simper`
- **THEN** the API SHALL persist it, since the slug is defined in the contracts package

#### Scenario: Existing grants are unaffected

- **WHEN** the slug list is widened
- **THEN** every existing permission record SHALL remain valid and SHALL continue to resolve to the same menu

#### Scenario: A role without the grant has no access

- **WHEN** a caller whose role holds no grant on `kode-simper` requests the qualification catalogue
- **THEN** the API SHALL respond 403
