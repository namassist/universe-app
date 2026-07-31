## ADDED Requirements

### Requirement: Every employee write is bounded by the caller's scope

A caller holding `manage` on `employees` SHALL be able to write only within the
data their scope permits. The scope predicate that filters reads SHALL bound
writes equally — creating, editing, deleting, and replacing a photo — and SHALL
be applied by the API on every route independently of what the client renders.

For a caller of narrower scope than `all`:

- **Creation** SHALL take the employee's department from the caller's own
  employee record, and the company from that department. Any department or
  company named in the request body SHALL have no effect and SHALL NOT be read.
- **Editing, deleting, and replacing a photo** SHALL resolve the target through
  the scope predicate and SHALL respond **404** when it falls outside — the same
  answer as reading it. The API SHALL NOT respond 403 for an out-of-scope
  employee, because an existence answer that differs for records outside the
  caller's scope is a register that can be enumerated one NIK at a time.
- An **edit** SHALL read the employee's company and department from the record as
  it stands, so a transfer to another department SHALL NOT be achievable as a
  field edit.
- An **import** SHALL refuse a row on either side of the pairing: a row filing an
  employee into another department, and a row naming a NIK that currently belongs
  to one.

A refused write SHALL NOT disclose the record it refused. No write route SHALL
return an employee that the corresponding read route would have answered 404 for.

An `all`-scoped caller SHALL be unaffected and SHALL continue to state the
company and department itself.

#### Scenario: Editing an employee of another department is not found

- **WHEN** a `dept`-scoped caller holding `manage` edits an employee of another department by NIK
- **THEN** the API SHALL respond 404, and the employee SHALL be unchanged

#### Scenario: A write does not disclose what a read refuses

- **WHEN** a scoped caller sends an edit for an out-of-scope employee
- **THEN** the response SHALL NOT contain that employee's record

#### Scenario: Deleting an employee of another department is not found

- **WHEN** a `dept`-scoped caller holding `manage` deletes an employee of another department by NIK
- **THEN** the API SHALL respond 404, and the employee SHALL remain

#### Scenario: A created employee lands in the caller's own department

- **WHEN** a `dept`-scoped caller creates an employee whose request body names another department
- **THEN** the employee SHALL be created in the caller's own department, and the named department SHALL have no effect

#### Scenario: An edit cannot transfer one of the caller's own employees away

- **WHEN** a `dept`-scoped caller edits an employee of their own department, naming another department
- **THEN** the employee SHALL remain in the caller's department

#### Scenario: A scoped import cannot reach another department

- **WHEN** a `dept`-scoped caller imports a spreadsheet containing rows for other departments
- **THEN** those rows SHALL be reported as errors and SHALL NOT be written

#### Scenario: An all-scoped caller reaches every department

- **WHEN** an `all`-scoped caller holding `manage` edits an employee of any department
- **THEN** the API SHALL respond 200 and the change SHALL be persisted

#### Scenario: The client's rendering is not the boundary

- **WHEN** a scoped caller's screen disables the company and department selectors
- **THEN** the API SHALL enforce the same restriction independently of that, for a request that omits or contradicts them

## MODIFIED Requirements

### Requirement: NIK is the employee's unique business key

An employee's NIK SHALL be unique across all employees. The API SHALL address a
single employee by NIK, while the stored primary key SHALL be a generated
identifier rather than the NIK itself.

A NIK SHALL be stored trimmed of leading and trailing whitespace.

An account references its employee by NIK rather than by a foreign key, because
accounts and employee records have different lifetimes. Changing an employee's
NIK SHALL therefore carry the new NIK to the account holding the old one, in the
same transaction that renames the employee, so the two SHALL NOT disagree even
momentarily. The account's cached session data SHALL be invalidated, so the next
request resolves scope through the NIK as renamed.

Renaming an employee onto a NIK that another account already holds SHALL be
refused with 409, and neither record SHALL change. The unique constraint on the
account's NIK SHALL catch the same collision when two renames race, and SHALL be
reported as the same refusal rather than as an internal error.

A rename SHALL NOT affect roster days or roster revision entries, which reference
the employee's generated identifier rather than the NIK.

#### Scenario: Duplicate NIK rejected

- **WHEN** a caller creates an employee whose NIK already exists
- **THEN** the API SHALL respond 409 and SHALL NOT create the employee

#### Scenario: Address an employee by NIK

- **WHEN** a caller requests, edits, or deletes an employee by its NIK
- **THEN** the API SHALL resolve the correct record

#### Scenario: NIK is required

- **WHEN** a caller creates an employee with no NIK or an empty NIK
- **THEN** the API SHALL respond 422 and SHALL NOT create the employee

#### Scenario: A rename carries the account holding the NIK

- **WHEN** an employee whose NIK an account carries is renamed
- **THEN** the account SHALL carry the new NIK, and the link SHALL still resolve to that employee

#### Scenario: A renamed account's scope still resolves

- **WHEN** the holder of a `dept`-scoped account makes a request after their employee record's NIK was renamed
- **THEN** their scope SHALL resolve to the same department as before, rather than returning nothing

#### Scenario: A rename onto a NIK an account already holds is refused

- **WHEN** an employee is renamed to a NIK that another account carries
- **THEN** the API SHALL respond 409 identifying the NIK as taken, and neither the employee nor either account SHALL change

#### Scenario: Roster history survives a rename

- **WHEN** an employee with roster days and revision entries is renamed
- **THEN** those days and entries SHALL still resolve to that employee

### Requirement: An employee's catalogued attributes are references, not free text

An employee's company, position, department, mess, and SIMPER permit type SHALL
be stored as references to master catalogue records rather than as free text.

Company, position, and department SHALL be required. Mess and SIMPER permit type
SHALL be optional, because an employee may live off site and may hold no permit
at all.

The company, department, and position SHALL together form one chain: the
department SHALL belong to the named company, and the position SHALL belong to
the named department. A combination that does not SHALL be refused, naming which
link failed rather than reporting a generic constraint failure.

The company SHALL be stored on the employee record rather than derived through
the department, because it is read on nearly every employee query. The pairing
SHALL be checked wherever an employee is written — the create route, the edit
route, and both import paths.

Block, room, telephone, and emergency contact SHALL remain free text, as they
carry no attributes and participate in no matching.

#### Scenario: Reference that does not resolve

- **WHEN** a caller creates or edits an employee naming a catalogue record that does not exist
- **THEN** the API SHALL respond 422 and SHALL identify which field failed to resolve, rather than reporting a generic constraint failure

#### Scenario: A department belonging to another company is refused

- **WHEN** a caller creates or edits an employee naming a company and a department that belongs to a different company
- **THEN** the API SHALL respond 422 and SHALL identify the department as the field that failed

#### Scenario: A position outside the named department is refused

- **WHEN** a caller creates or edits an employee naming a position that belongs to a department other than the one named
- **THEN** the API SHALL respond 422 and SHALL identify the position as the field that failed

#### Scenario: The chain is validated on every write path

- **WHEN** an employee is written through the create route, the edit route, or an import commit
- **THEN** the same pairing check SHALL apply, and no path SHALL persist a mismatched combination

#### Scenario: Reference names are returned with the employee

- **WHEN** a caller reads an employee or the employee list
- **THEN** each catalogued attribute SHALL be returned with both its identifier and its name, so a client need not resolve it separately

#### Scenario: An employee without a mess

- **WHEN** an employee is created with no mess reference
- **THEN** the employee SHALL be persisted and SHALL be returned with a null mess, rather than being rejected
