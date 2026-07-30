# roster-data Specification

## Purpose

The monthly roster as stored data: the fixed code vocabulary the database, the
API, and every client share, the semantic kind each code carries, the monthly
document a department owns, the archiving that keeps a re-uploaded month
readable as it stood, the validation that ties a roster day to an employee that
exists, and the scope that filters every roster read.

## Requirements

### Requirement: Roster codes are a fixed shared vocabulary

The system SHALL define the roster code vocabulary as a fixed list shared by the
database, the API schema, and every client, so that a code accepted by one is
accepted by all.

The vocabulary SHALL be the twenty-eight codes of the roster legend. A value
outside it SHALL NOT be storable as a roster code.

Adding or removing a code SHALL be a change to the shared definition, not a
record an operator can create at runtime.

#### Scenario: A code outside the vocabulary is refused

- **WHEN** a caller submits a roster code that is not in the vocabulary
- **THEN** the API SHALL respond 422 and SHALL NOT store the value

#### Scenario: The vocabulary is one definition

- **WHEN** the database, the API schema, and the client are compared
- **THEN** all three SHALL derive the roster codes from the same shared definition

#### Scenario: Codes cannot be created at runtime

- **WHEN** a caller attempts to add a roster code through any API route
- **THEN** no route SHALL exist that creates one

### Requirement: Every roster code carries a semantic kind

Each roster code SHALL be classified by a kind that states what the code means
operationally, distinct from the grouping used to present the legend.

Exactly one code SHALL mean "scheduled, day shift" and exactly one SHALL mean
"scheduled, night shift". Every other code SHALL mean the person is not
available for a unit that day, and its kind SHALL distinguish why.

The kind SHALL be derived from the code rather than stored alongside it, so a
stored roster day cannot disagree with the classification.

#### Scenario: Scheduled for a shift

- **WHEN** a roster day carries the day-shift code or the night-shift code
- **THEN** its kind SHALL identify that shift, and the employee SHALL be considered scheduled for it

#### Scenario: Every other code is unavailable

- **WHEN** a roster day carries any code other than the two shift codes
- **THEN** the employee SHALL NOT be considered scheduled for any shift that day

#### Scenario: The kind is not stored

- **WHEN** a roster day is persisted
- **THEN** only its code SHALL be stored, and its kind SHALL be resolved from the shared definition on read

#### Scenario: Presentation grouping is separate from kind

- **WHEN** the legend is rendered
- **THEN** its grouping SHALL be presentation only and SHALL NOT be the classification the allocation logic reads

### Requirement: The roster carries no unit or spare information

A roster day SHALL record which shift an employee is scheduled for and nothing
more. It SHALL NOT record a unit, a unit assignment, or whether the employee is
a spare.

A spare operator SHALL be rostered with the same shift codes as an operator who
holds a unit. Being a spare SHALL be a property of holding no unit, resolved
outside the roster.

#### Scenario: A spare is rostered like anyone else

- **WHEN** an operator who holds no unit is rostered for a shift
- **THEN** the roster day SHALL carry the same shift code as an operator who holds a unit, with nothing distinguishing them in the roster

#### Scenario: No unit reference on a roster day

- **WHEN** a roster day is read
- **THEN** it SHALL carry no unit reference and no spare indicator

### Requirement: A roster is a monthly document owned by one department

The system SHALL persist a roster upload as a document carrying the department
it covers, the month it covers, the name of the uploaded file, the account that
uploaded it, and a status of active or archived.

A document's daily codes SHALL be stored as rows belonging to that document. A
row SHALL identify the employee, the date, and the code, and SHALL be unique per
document, employee, and date.

Records created through the API SHALL survive a reload and SHALL be visible to
every other caller immediately.

#### Scenario: An upload becomes a document

- **WHEN** a caller holding `manage` on `roster-data` commits a roster upload
- **THEN** a document SHALL be persisted with its department, month, file name, uploader, and an active status, and its daily rows SHALL be persisted against it

#### Scenario: One code per employee per day within a document

- **WHEN** a document would receive a second row for the same employee and date
- **THEN** the second row SHALL be refused

#### Scenario: Records survive a reload

- **WHEN** a roster is uploaded and the client is reloaded
- **THEN** the document and its daily codes SHALL still be present, with no dependence on client-side state

#### Scenario: Document not found

- **WHEN** a caller requests a roster document that does not exist
- **THEN** the API SHALL respond 404

### Requirement: The roster in force is the active document

At most one document SHALL be active for a given department and month. The
roster in force for a date SHALL be the daily rows of the active document
covering it.

Archived documents SHALL retain their daily rows in full, so that the roster as
it stood at the time can still be read.

#### Scenario: Reading the roster in force

- **WHEN** the roster for a date is read
- **THEN** only rows belonging to active documents SHALL be returned

#### Scenario: An archived document keeps its rows

- **WHEN** an archived document's detail is requested
- **THEN** its daily rows SHALL be returned in full, exactly as they stood when it was archived

#### Scenario: Two active documents for one month are impossible

- **WHEN** a second document would become active for a department and month that already has one
- **THEN** the system SHALL refuse the state, and the constraint SHALL be enforced by the database rather than by the route alone

### Requirement: Re-uploading a month archives the previous document

Committing an upload for a department and month that already has an active
document SHALL archive that document and make the new one active, in a single
transaction.

The archived document's daily rows SHALL NOT be deleted, moved, or overwritten.

#### Scenario: Re-upload archives rather than overwrites

- **WHEN** a caller commits an upload for a department and month that already has an active document
- **THEN** the previous document SHALL become archived, the new document SHALL become active, and both SHALL retain their own daily rows

#### Scenario: The swap is atomic

- **WHEN** a re-upload fails partway
- **THEN** the previous document SHALL remain active and no rows of the new document SHALL be visible

### Requirement: The department and month of an upload are stated, not inferred

An upload SHALL carry the department and the month as explicit inputs. The
system SHALL NOT derive either from the file name or from a cell inside the
spreadsheet.

Every row SHALL be validated against the stated department, and a row whose NIK
belongs to another department SHALL be reported as a failed row naming both
departments.

A caller whose scope restricts it to one department SHALL have the upload's
department resolved from its own record rather than read from the request.

#### Scenario: Department and month are required

- **WHEN** a caller previews an upload without a department or without a month
- **THEN** the API SHALL respond 422 and SHALL NOT parse the file

#### Scenario: A row from another department is reported

- **WHEN** a file contains a NIK belonging to a department other than the stated one
- **THEN** the preview SHALL report that row as a failed row, naming the row's department and the stated department

#### Scenario: A scoped caller cannot upload for another department

- **WHEN** a `dept`-scoped caller submits an upload naming a department other than its own
- **THEN** the department SHALL be resolved from the caller's own record and the request's value SHALL be ignored

#### Scenario: The month is never taken from the file

- **WHEN** a file carries a month in its name or in a cell that differs from the stated month
- **THEN** the stated month SHALL decide, and the file's value SHALL have no effect

### Requirement: A roster day names an employee that exists

Every roster day SHALL reference an existing employee record. A row whose NIK
matches no employee SHALL be reported as a failed row and SHALL NOT be written.

A roster day SHALL count as a reference that prevents its employee from being
deleted.

#### Scenario: Unknown NIK

- **WHEN** a file contains a NIK that no employee record carries
- **THEN** the preview SHALL report that row as a failed row and the commit SHALL NOT write it

#### Scenario: Roster days protect the employee

- **WHEN** a caller attempts to delete an employee that has roster days
- **THEN** the API SHALL respond 409, SHALL name the roster as the reason, and the employee SHALL remain

### Requirement: Roster reads are filtered by the caller's scope

Roster documents, daily codes, and their aggregates SHALL be constrained by the
caller's scope, using the same resolution as every other scoped collection.

#### Scenario: Dept scope on roster documents

- **WHEN** a `dept`-scoped caller lists roster documents
- **THEN** only documents of the department its own employee record identifies SHALL be returned

#### Scenario: Self scope on roster days

- **WHEN** a `self`-scoped caller reads roster days
- **THEN** only the days of the employee whose NIK matches the caller SHALL be returned

#### Scenario: Scope applies to a document requested directly

- **WHEN** a scoped caller requests a roster document outside its scope by identifier
- **THEN** the API SHALL respond 404 or 403 and SHALL NOT return the document

### Requirement: The roster screens read and write the API

The roster list, the document detail grid, and the upload screen SHALL be served
by the API. They SHALL NOT read compiled-in sample data, and a mutation SHALL
NOT be reported as successful without a persisted result.

The document detail grid SHALL be paginated by the API rather than by slicing a
fully loaded month in the browser.

#### Scenario: The list reflects stored documents

- **WHEN** the roster list is opened
- **THEN** it SHALL render the documents the API returns, and a newly committed upload SHALL appear without a full page reload

#### Scenario: No sample data remains

- **WHEN** the roster screens are inspected
- **THEN** no roster document, daily grid, or validation result SHALL originate from a compiled-in array

#### Scenario: Upload progress reflects a real request

- **WHEN** a file is uploaded
- **THEN** the progress shown SHALL follow the actual request, and no simulated timer SHALL stand in for it

#### Scenario: The detail grid pages against the API

- **WHEN** an operator moves to another page of a document's grid
- **THEN** the rows SHALL be requested from the API rather than sliced from a month already held in the browser
