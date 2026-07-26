# rbac Specification

## Purpose

Server-enforced authorization for the UNIVERSE platform: roles as
runtime-managed records, permissions as grants of a mode on a menu slug, scope
as the filter over the records a caller may read and mutate, and the rule that
every API route enforces both independently of any client-side gating.

## Requirements

### Requirement: Roles are runtime-managed records

Roles SHALL be stored as database rows and SHALL be creatable, editable, and
deletable at runtime by a caller holding `manage` on the `roles` menu. Adding a
role MUST NOT require a code change or a deployment.

#### Scenario: Create a role

- **WHEN** an authorized caller creates a role with a name, scope, and permission set
- **THEN** the role SHALL be persisted and SHALL be assignable to accounts immediately

#### Scenario: Edit a role

- **WHEN** an authorized caller changes a role's permissions or scope
- **THEN** the change SHALL be persisted and SHALL apply to every account holding that role

#### Scenario: A locked role cannot be deleted

- **WHEN** a caller attempts to delete a role whose `locked` flag is true
- **THEN** the API SHALL respond 409 and the role SHALL remain

#### Scenario: A role still in use cannot be deleted

- **WHEN** a caller attempts to delete a role assigned to at least one account
- **THEN** the API SHALL respond 409 and report the number of accounts holding it

#### Scenario: Unauthorized role management

- **WHEN** a caller without `manage` on `roles` attempts any role mutation
- **THEN** the API SHALL respond 403

### Requirement: Seeded roles reproduce the established access matrix

The system SHALL seed six roles — `superadmin`, `admin`, `manajer`, `manpower`,
`medic`, `user` — with the permissions and scopes established for the product.
The seed MUST be idempotent.

#### Scenario: Superadmin

- **WHEN** the seed runs
- **THEN** `superadmin` SHALL hold `manage` on all 30 menu slugs, SHALL have scope `all`, and SHALL be `locked`

#### Scenario: Admin

- **WHEN** the seed runs
- **THEN** `admin` SHALL have scope `dept`, `manage` on `employees`, `roster-data`, `roster-revision`, and `attendance`, and `view` on `dashboard`, `display-attendance`, `display-fleet`, `fit-to-work`, `unit-status`, `fleet-allocation`, and `fleet-setting`

#### Scenario: Manajer

- **WHEN** the seed runs
- **THEN** `manajer` SHALL have scope `dept`, `manage` on `roster-approval` only, and `view` on the other eleven menus of its remit

#### Scenario: Manpower

- **WHEN** the seed runs
- **THEN** `manpower` SHALL have scope `all` and `manage` on all 22 menus of its remit, including every master-data menu and `setting`, with no `view`-only grants

#### Scenario: Medic

- **WHEN** the seed runs
- **THEN** `medic` SHALL have scope `all`, `manage` on `fit-to-work`, and `view` on `dashboard`, `display-attendance`, `display-fleet`, `display-fitwork`, and `employees`

#### Scenario: User

- **WHEN** the seed runs
- **THEN** `user` SHALL have scope `self`, `manage` on `fit-to-work`, and `view` on `dashboard`, `employees`, `roster-data`, `roster-revision`, and `attendance`

#### Scenario: Re-running the seed

- **WHEN** the seed runs against a database that already contains the six roles
- **THEN** it SHALL complete without error and SHALL NOT duplicate roles or permission rows

### Requirement: Permissions are grants of a mode on a menu slug

A permission SHALL be a record of a role, a menu slug, and a mode of `view` or
`manage`. The absence of a record SHALL mean no access; a `none` mode MUST NOT
be stored. A menu slug MUST be one of the slugs defined in the shared contracts
package.

#### Scenario: Absent grant means hidden

- **WHEN** a role has no permission record for a menu slug
- **THEN** that menu SHALL be treated as inaccessible for that role

#### Scenario: Unknown menu slug rejected

- **WHEN** a permission is submitted for a slug not defined in the contracts package
- **THEN** the API SHALL respond 422 and SHALL NOT persist the record

#### Scenario: Menus are not runtime-creatable

- **WHEN** a caller attempts to introduce a new menu slug through the roles API
- **THEN** the API SHALL reject it, since a slug corresponds to a page that exists in code

### Requirement: An account holds exactly one role

Every account SHALL reference exactly one role. Multiple simultaneous roles MUST
NOT be assignable.

#### Scenario: Assign a role

- **WHEN** an authorized caller assigns a role to an account
- **THEN** the account's previous role SHALL be replaced, not supplemented

#### Scenario: Account always has a role

- **WHEN** an account is created without a role
- **THEN** the API SHALL respond 422

### Requirement: Scope assignment invariants

A role's scope SHALL determine what an account must carry. An account MUST NOT
be assigned a role whose scope it cannot satisfy.

#### Scenario: Self scope requires a NIK

- **WHEN** a role with scope `self` is assigned to an account with no NIK
- **THEN** the API SHALL respond 422, because NIK is the only link to the account's own employee record

#### Scenario: Dept scope requires a NIK

- **WHEN** a role with scope `dept` is assigned to an account with no NIK
- **THEN** the API SHALL respond 422, because a caller's departemen is resolved through the employee record its NIK identifies

#### Scenario: All scope has no prerequisite

- **WHEN** a role with scope `all` is assigned to an account carrying no NIK
- **THEN** the assignment SHALL succeed

#### Scenario: Narrowing a role's scope validates existing holders

- **WHEN** a role's scope is changed to one that an existing holder cannot satisfy
- **THEN** the API SHALL respond 409 and identify the accounts that would be invalidated

### Requirement: The API enforces menu permission on every route

Every route SHALL declare the menu slug and mode it requires, and the API SHALL
reject callers lacking that grant. Enforcement MUST NOT depend on the client.

#### Scenario: Read with view grant

- **WHEN** a caller holding `view` on a menu requests a read endpoint for it
- **THEN** the API SHALL respond 200

#### Scenario: Write with only view grant

- **WHEN** a caller holding `view` on a menu invokes a mutating endpoint for it
- **THEN** the API SHALL respond 403

#### Scenario: Write with manage grant

- **WHEN** a caller holding `manage` on a menu invokes a mutating endpoint for it
- **THEN** the API SHALL respond 200

#### Scenario: No grant at all

- **WHEN** a caller with no permission record for a menu requests any of its endpoints
- **THEN** the API SHALL respond 403

#### Scenario: Unauthenticated caller

- **WHEN** no session is presented to a permission-guarded route
- **THEN** the API SHALL respond 401 rather than 403

### Requirement: Scope filters returned data

The caller's scope SHALL constrain which records the API returns and mutates,
across employees, roster, revisions, attendance, Fit To Work, units, fleet
allocation, and dashboard aggregates.

#### Scenario: All scope

- **WHEN** a caller whose scope is `all` lists a scoped collection
- **THEN** the API SHALL return records across every departemen

#### Scenario: Dept scope

- **WHEN** a caller whose scope is `dept` lists a scoped collection
- **THEN** the API SHALL return only records belonging to the departemen of the employee record the caller's NIK identifies

#### Scenario: Dept scope that cannot be resolved

- **WHEN** a `dept`-scoped caller's departemen cannot be determined, because no employee record matches its NIK or employee master data is not yet present
- **THEN** the API SHALL return an empty set and SHALL NOT return the unfiltered collection

#### Scenario: Self scope

- **WHEN** a caller whose scope is `self` lists a scoped collection
- **THEN** the API SHALL return only records belonging to that caller's own NIK

#### Scenario: Dashboard aggregates respect scope

- **WHEN** a caller requests dashboard figures
- **THEN** the aggregates SHALL be computed over the same record set the caller's scope permits, not over the whole site

#### Scenario: Mutation outside scope

- **WHEN** a caller attempts to modify a record outside its scope
- **THEN** the API SHALL respond 404 or 403 and SHALL NOT modify the record

#### Scenario: Scope with no meaningful predicate fails closed

- **WHEN** a `self`-scoped caller reaches a collection that has no per-account dimension, such as units
- **THEN** the API SHALL return an empty set rather than the full collection

### Requirement: Permission and role changes take effect on the next request

A change to a role's permissions or scope, or to an account's role, SHALL apply
to the affected sessions on their next request without requiring re-login.

#### Scenario: Permission revoked mid-session

- **WHEN** a role loses `manage` on a menu while a holder has a live session
- **THEN** that holder's next mutating request to the menu SHALL respond 403

#### Scenario: Permission granted mid-session

- **WHEN** a role gains access to a menu while a holder has a live session
- **THEN** that holder's next session read SHALL include the menu and its navigation SHALL show it

#### Scenario: Role reassigned mid-session

- **WHEN** an account's role is changed while it has a live session
- **THEN** its next request SHALL be evaluated against the new role

### Requirement: Web navigation is derived from the session

The web shell SHALL derive both menu visibility and read/write affordances from
the caller's session. A page MUST NOT declare its own access mode as a build-time
constant, and the role MUST NOT be taken from the URL.

#### Scenario: Navigation reflects permissions

- **WHEN** the shell renders for an authenticated caller
- **THEN** it SHALL show exactly the menus the session reports and SHALL hide navigation groups whose children are all hidden

#### Scenario: Read-only affordances

- **WHEN** a menu is granted at `view`
- **THEN** its page SHALL render without create, edit, delete, import, or approve controls

#### Scenario: Direct navigation to an ungranted menu

- **WHEN** an authenticated caller navigates directly to the route of a menu it lacks
- **THEN** the shell SHALL render not-found and any data request behind it SHALL be refused by the API

#### Scenario: Unauthenticated access to the shell

- **WHEN** a caller with no session requests any shell route
- **THEN** it SHALL be redirected to the login page

### Requirement: Client-side gating is not the security boundary

The web middleware and shell SHALL be treated as user experience only. Every API
route SHALL enforce permission and scope independently of any client check.

#### Scenario: Client check bypassed

- **WHEN** a caller defeats the web guard and issues requests directly to the API
- **THEN** every request SHALL still be evaluated for session, permission, and scope, and SHALL be refused where any of them fails
