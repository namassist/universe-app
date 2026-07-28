## ADDED Requirements

### Requirement: Employees are persisted records

The system SHALL persist employees as database records. An employee SHALL carry
a NIK, a full name, a company reference, a position reference, a department
reference, a join date, and an employment status, in addition to the optional
fields defined below.

Records created, edited, or deleted through the API SHALL survive a page reload
and SHALL be visible to every other caller immediately.

#### Scenario: Create an employee

- **WHEN** a caller holding `manage` on `employees` creates an employee with a NIK, a name, and its catalogue references
- **THEN** the employee SHALL be persisted, SHALL be returned with a generated identifier, and SHALL appear in subsequent list responses

#### Scenario: Edit an employee

- **WHEN** a caller holding `manage` on `employees` changes an employee's fields
- **THEN** the change SHALL be persisted and SHALL be visible to every caller on the next read

#### Scenario: Records survive a reload

- **WHEN** an employee is created and the client is reloaded
- **THEN** the employee SHALL still be present, with no dependence on client-side state

#### Scenario: Employee not found

- **WHEN** a caller requests an employee by a NIK that no record carries
- **THEN** the API SHALL respond 404

### Requirement: NIK is the employee's unique business key

An employee's NIK SHALL be unique across all employees. The API SHALL address a
single employee by NIK, while the stored primary key SHALL be a generated
identifier rather than the NIK itself.

A NIK SHALL be stored trimmed of leading and trailing whitespace.

#### Scenario: Duplicate NIK rejected

- **WHEN** a caller creates an employee whose NIK already exists
- **THEN** the API SHALL respond 409 and SHALL NOT create the employee

#### Scenario: Address an employee by NIK

- **WHEN** a caller requests, edits, or deletes an employee by its NIK
- **THEN** the API SHALL resolve the correct record

#### Scenario: NIK is required

- **WHEN** a caller creates an employee with no NIK or an empty NIK
- **THEN** the API SHALL respond 422 and SHALL NOT create the employee

### Requirement: An employee's catalogued attributes are references, not free text

An employee's company, position, department, mess, and SIMPER permit type SHALL
be stored as references to master catalogue records rather than as free text.

Company, position, and department SHALL be required. Mess and SIMPER permit type
SHALL be optional, because an employee may live off site and may hold no permit
at all.

Block, room, telephone, and emergency contact SHALL remain free text, as they
carry no attributes and participate in no matching.

#### Scenario: Reference that does not resolve

- **WHEN** a caller creates or edits an employee naming a catalogue record that does not exist
- **THEN** the API SHALL respond 422 and SHALL identify which field failed to resolve, rather than reporting a generic constraint failure

#### Scenario: Reference names are returned with the employee

- **WHEN** a caller reads an employee or the employee list
- **THEN** each catalogued attribute SHALL be returned with both its identifier and its name, so a client need not resolve it separately

#### Scenario: An employee without a mess

- **WHEN** an employee is created with no mess reference
- **THEN** the employee SHALL be persisted and SHALL be returned with a null mess, rather than being rejected

### Requirement: An employee's SIMPER and medical data record the value in force

An employee SHALL carry a SIMPER permit type reference, a SIMPER number, and a
SIMPER expiry date; and an MCU result, an MCU expiry date, a blood type, and a
medical history note.

These fields SHALL record the value currently in force. The system SHALL NOT
retain previous values when they are renewed.

MCU result and blood type SHALL be constrained to the values defined in the
shared contracts package.

#### Scenario: Renewing a SIMPER

- **WHEN** an employee's SIMPER number and expiry are changed
- **THEN** the new values SHALL replace the previous ones and no historical record SHALL be created

#### Scenario: An employee holding no SIMPER

- **WHEN** an employee is created with no SIMPER permit type, number, or expiry
- **THEN** the employee SHALL be persisted, because an employee who does not operate a unit holds no permit

#### Scenario: Blood type outside the defined values

- **WHEN** a caller submits a blood type that is not one of the defined values
- **THEN** the API SHALL respond 422

### Requirement: SIMPER qualification codes are a many-to-many relation

An employee's operating skills SHALL be stored as references to SIMPER
qualification code records, with an employee able to hold many codes and a code
able to be held by many employees.

A skill SHALL NOT be stored as text. The same code SHALL NOT be recorded twice
for one employee.

This relation is what determines whether an employee may be allocated to a unit,
by matching against the unit's qualification code.

#### Scenario: Assign skills

- **WHEN** a caller holding `manage` on `employees` assigns qualification codes to an employee
- **THEN** the codes SHALL be persisted as references and SHALL be returned with the employee

#### Scenario: Unknown qualification code

- **WHEN** a caller assigns a qualification code that no catalogue record matches
- **THEN** the API SHALL respond 422 and SHALL NOT create the code

#### Scenario: Duplicate code in one submission

- **WHEN** a caller submits the same qualification code twice for one employee
- **THEN** the employee SHALL hold that code once

#### Scenario: Skills answer unit eligibility

- **WHEN** the employees eligible for a unit are requested
- **THEN** the answer SHALL be derivable by matching the employees' qualification codes against the unit's qualification code, without comparing text

#### Scenario: Replacing an employee's skills

- **WHEN** an employee is edited with a different set of qualification codes
- **THEN** the stored set SHALL match the submitted set exactly, with removed codes no longer present

### Requirement: Employment status is active or inactive

An employee's status SHALL be one of exactly two values: active or inactive. The
status SHALL describe employment, not day-to-day availability.

Leave SHALL NOT be an employment status, because leave is dated and is owned by
the roster.

#### Scenario: Deactivate an employee

- **WHEN** a caller holding `manage` on `employees` sets an employee inactive
- **THEN** the employee SHALL remain readable and SHALL be excluded from lists filtered to active employees

#### Scenario: Status outside the defined values

- **WHEN** a caller submits a status that is not active or inactive
- **THEN** the API SHALL respond 422

### Requirement: An employee with a trace cannot be deleted

Deleting an employee that is still referenced SHALL be refused. The API SHALL
respond 409 and SHALL name what references it, and the employee SHALL remain.

An account whose NIK matches the employee SHALL count as a reference, even
though no database constraint enforces it.

#### Scenario: Delete an employee who has an account

- **WHEN** a caller attempts to delete an employee whose NIK an account carries
- **THEN** the API SHALL respond 409, SHALL name the account as the reason, and the employee SHALL remain

#### Scenario: Delete an employee with no trace

- **WHEN** a caller holding `manage` on `employees` deletes an employee that nothing references
- **THEN** the employee SHALL be removed, together with its qualification code assignments

#### Scenario: Deletion never cascades to referencing records

- **WHEN** a deletion of a referenced employee is attempted
- **THEN** no referencing record SHALL be deleted, altered, or left with an unresolvable reference

### Requirement: An employee photo is stored as a file, not in the database

The system SHALL allow an employee photo to be uploaded and served. The image
bytes SHALL be stored on the filesystem in a configured directory and SHALL NOT
be stored in the database; the database SHALL hold only the stored filename.

The stored filename SHALL be generated by the system and SHALL NOT be derived
from the name the client supplied.

Uploads SHALL be constrained by size and by image type, and the health endpoint
SHALL report whether the configured directory is writable.

#### Scenario: Upload a photo

- **WHEN** a caller holding `manage` on `employees` uploads a JPEG or PNG for an employee
- **THEN** the file SHALL be written to the configured directory under a generated name, and the employee SHALL reference it

#### Scenario: A hostile filename cannot escape the directory

- **WHEN** an upload carries a filename containing path separators or parent-directory segments
- **THEN** the stored file SHALL be written inside the configured directory under a generated name, and no path outside it SHALL be addressed

#### Scenario: Oversized or non-image upload

- **WHEN** an upload exceeds the size cap or is not an accepted image type
- **THEN** the API SHALL reject it and SHALL NOT write any file

#### Scenario: Replacing a photo

- **WHEN** an employee who already has a photo receives a new one
- **THEN** the employee SHALL reference the new file and the previous file SHALL be removed

#### Scenario: Storage directory reported by health

- **WHEN** the health endpoint is requested
- **THEN** it SHALL report whether the photo directory is writable, separately from the database and cache

#### Scenario: An employee without a photo

- **WHEN** an employee that has no photo is read
- **THEN** the response SHALL indicate the absence rather than failing

### Requirement: The employee list is searched and filtered by the API

Listing employees SHALL accept a search term and filters, and SHALL apply them
on the server rather than returning the full collection for the client to
filter.

Search SHALL match the employee's name and NIK, and SHALL reach the names of the
catalogues the employee references.

#### Scenario: Search reaches catalogue names

- **WHEN** a caller searches for a department name
- **THEN** the response SHALL include the employees belonging to that department

#### Scenario: Filter by status

- **WHEN** a caller lists employees filtered to active
- **THEN** only active employees SHALL be returned

#### Scenario: Filter by department

- **WHEN** a caller lists employees filtered by department
- **THEN** only employees of that department SHALL be returned, subject to the caller's scope

### Requirement: The employee screens read and write the API

The Karyawan list, detail, and form screens SHALL read their records from the
API and SHALL persist their changes through it. They SHALL NOT read employees
from a compiled-in array.

A change made on one screen SHALL be visible to another client on its next read.

#### Scenario: The list renders API data

- **WHEN** the Karyawan list is opened
- **THEN** the rows SHALL be the employees the API returns, and none SHALL originate from client-side sample data

#### Scenario: Creating an employee persists it

- **WHEN** an operator submits the employee form
- **THEN** the record SHALL be created through the API and SHALL still be present after a reload

#### Scenario: A mutation refreshes the affected data

- **WHEN** an employee is created, edited, or deleted
- **THEN** the client SHALL refresh the affected query rather than reloading the route

#### Scenario: A read-only caller cannot mutate

- **WHEN** a caller holding only `view` on `employees` opens the screens
- **THEN** the create, edit, and delete controls SHALL be absent, and the API SHALL refuse those operations independently
