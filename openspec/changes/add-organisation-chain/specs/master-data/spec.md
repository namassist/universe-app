## ADDED Requirements

### Requirement: Departments and positions belong to a parent catalogue record

The company, department, and position catalogues SHALL form a chain: a
department SHALL belong to exactly one company, and a position SHALL belong to
exactly one department.

Both references SHALL be required and SHALL be enforced by the database rather
than by the route alone, so no path — route, import, seeder, or direct write —
can produce a department without a company or a position without a department.

A company SHALL additionally carry a short code, unique without regard to case,
by which the organisation is named in reports and sheets.

The chain SHALL stop at three levels. A department SHALL NOT contain another
department, and a position SHALL NOT contain another position.

#### Scenario: Create a department under a company

- **WHEN** a caller holding `manage` on `departemen` creates a department naming a company
- **THEN** the department SHALL be persisted against that company, and the response SHALL identify the company

#### Scenario: A department without a company is refused

- **WHEN** a caller creates a department naming no company
- **THEN** the API SHALL respond 422 and SHALL NOT create the record

#### Scenario: A position without a department is refused

- **WHEN** a caller creates a position naming no department
- **THEN** the API SHALL respond 422 and SHALL NOT create the record

#### Scenario: A parent that does not resolve

- **WHEN** a caller creates a department naming a company identifier that no record matches
- **THEN** the API SHALL respond 422, SHALL identify the company field as the one that failed, and SHALL NOT create the record

#### Scenario: A company code is unique without regard to case

- **WHEN** a caller creates a company with code `udu` while a company with code `UDU` exists
- **THEN** the API SHALL respond 409 and SHALL NOT create the record

#### Scenario: The chain is readable in one response

- **WHEN** a caller lists the position catalogue
- **THEN** each record SHALL carry its department reference, and the response SHALL be sufficient to name the owning department without a second request

### Requirement: A catalogue record's parent is fixed at creation

A department's company and a position's department SHALL be set when the record
is created and SHALL NOT be changeable by an edit. The edit request schema SHALL
NOT declare a parent field, so a parent named in an edit request SHALL be
discarded before the handler runs and SHALL have no effect on the stored record.

Reassigning a parent re-files every employee, position, and roster document
beneath it in a single unaudited write. Where such a transfer is needed it SHALL
be an explicit operation that discloses what it moves, not a field on the form
used to correct a spelling.

#### Scenario: An edit cannot move a department to another company

- **WHEN** a caller edits a department and includes a company field
- **THEN** the department's company SHALL be unchanged, and the named company SHALL have no effect

#### Scenario: An edit may still correct the name

- **WHEN** a caller edits a department's name, description, or active flag without naming a parent
- **THEN** the change SHALL be persisted and the department SHALL remain under the same company

#### Scenario: The client does not offer the parent for editing

- **WHEN** a master screen opens an existing department or position for editing
- **THEN** the parent selector SHALL be disabled and SHALL state why, and the API SHALL ignore a parent field independently of that

### Requirement: A position declares whether it enters fleet allocation

A position SHALL carry a boolean marking whether people holding it enter fleet
allocation. The flag SHALL default to false for a newly created position, SHALL
be settable by a caller holding `manage` on the position catalogue, and SHALL be
readable wherever positions are listed.

The flag SHALL NOT be derived from the position's name or from its department. A
mining department holds positions that do not sit on a unit, and departments
outside mining hold positions that do.

#### Scenario: A position is marked for fleet allocation

- **WHEN** a caller holding `manage` on `jabatan` creates or edits a position with the flag set
- **THEN** the flag SHALL be persisted and SHALL be returned when the catalogue is read

#### Scenario: A new position does not allocate by default

- **WHEN** a position is created without the flag stated
- **THEN** the stored flag SHALL be false

#### Scenario: The flag is not inferred

- **WHEN** a position named for an operating role is created under a mining department without the flag set
- **THEN** the stored flag SHALL be false, because no name or department SHALL imply it

### Requirement: The master screens filter a catalogue by its parent

A master screen for a catalogue that has a parent SHALL offer a filter on that
parent, and SHALL name each row's parent so two same-named records under
different parents are distinguishable.

For the position catalogue the parent filter SHALL be the department, and a row
SHALL be identified by its company and department together, because a department
name alone is not unique across companies.

The menu whose slug is `jabatan` SHALL be labelled **Posisi** in the interface.
The slug SHALL remain `jabatan`, because it names a route path, a stored
permission grant, and a spreadsheet column heading.

#### Scenario: Filtering departments by company

- **WHEN** a caller opens the department screen and selects a company
- **THEN** only that company's departments SHALL be listed

#### Scenario: A position row names its whole path

- **WHEN** a caller lists positions across companies
- **THEN** each row SHALL name its company and its department, so two positions of the same name are distinguishable

#### Scenario: The label changes and the slug does not

- **WHEN** the position menu is rendered
- **THEN** it SHALL read `Posisi`, while the route path, the permission grant, and the import column heading SHALL still use `jabatan`

## MODIFIED Requirements

### Requirement: Each catalogue carries only the fields its screen needs

A catalogue's record shape SHALL be declared per kind rather than through
positional fields shared across kinds. The API response schema for a kind SHALL
name that kind's fields explicitly, so the generated OpenAPI document describes
each catalogue accurately.

Unit types, unit models, unit brands, and mess SHALL carry a name only. Unit
classes, SIMPER permit types, SIMPER qualification codes, departments,
companies, and positions SHALL additionally carry a description. Work areas
SHALL additionally carry a type.

Companies SHALL additionally carry a code. Departments SHALL additionally carry
their company reference. Positions SHALL additionally carry their department
reference and their fleet-allocation flag.

Where a record shape satisfies more than one declared schema, the schema that
names the most specific shape SHALL be the one applied, so no declared field is
dropped from a response by a broader schema matching first.

#### Scenario: A work area carries its type

- **WHEN** a caller reads the work-area catalogue
- **THEN** each record SHALL include a `type` field whose value is one of the defined area types

#### Scenario: A unit class carries its description

- **WHEN** a caller reads the unit-class catalogue
- **THEN** each record SHALL include a `description` field

#### Scenario: A company carries its description

- **WHEN** a caller reads the company catalogue
- **THEN** each record SHALL include a `description` field

#### Scenario: A company carries its code

- **WHEN** a caller reads the company catalogue
- **THEN** each record SHALL include a `code` field

#### Scenario: A department carries its company

- **WHEN** a caller reads the department catalogue
- **THEN** each record SHALL include its company reference

#### Scenario: A position carries its department and its fleet flag

- **WHEN** a caller reads the position catalogue
- **THEN** each record SHALL include its department reference and its fleet-allocation flag

#### Scenario: A broader schema does not strip a chained field

- **WHEN** a department is returned, whose shape also satisfies the schema for a catalogue carrying only a name and description
- **THEN** the company reference SHALL still be present in the response

#### Scenario: No positional fields are exposed

- **WHEN** the OpenAPI document is generated
- **THEN** no catalogue response schema SHALL contain fields named positionally rather than by meaning

### Requirement: Catalogue names are trimmed and unique without regard to case

A catalogue name SHALL be trimmed of leading and trailing whitespace before it
is stored. Names SHALL be unique when compared without regard to case, within
the scope that owns them.

For a catalogue with no parent, that scope SHALL be the catalogue itself. For a
catalogue with a parent, that scope SHALL be the parent record: a department name
SHALL be unique within its company, and a position name SHALL be unique within
its department.

Two companies SHALL therefore each be able to hold a department of the same
name, and two departments SHALL each be able to hold a position of the same
name. A name alone SHALL NOT be treated as identifying a department or a
position record anywhere in the system.

#### Scenario: Whitespace is trimmed

- **WHEN** a caller creates a record with the name `" BIGDIGGER "`
- **THEN** the stored name SHALL be `BIGDIGGER`

#### Scenario: Case-insensitive duplicate rejected

- **WHEN** a caller creates a record named `Hitachi` in a catalogue that already contains `HITACHI`
- **THEN** the API SHALL respond 409 and SHALL NOT create the record

#### Scenario: Casing as typed is preserved

- **WHEN** a caller creates a work area named `Panel East Puncak Utara`
- **THEN** the stored name SHALL retain that casing exactly and SHALL NOT be normalised to upper or lower case

#### Scenario: The same name in different catalogues

- **WHEN** a caller creates a unit class named `WHEEL EXCAVATOR` while a unit type of the same name exists
- **THEN** the record SHALL be created, because uniqueness is scoped to one catalogue

#### Scenario: The same department name under two companies

- **WHEN** a caller creates a department named `MINING OPERATION` under one company while another company already has one
- **THEN** the record SHALL be created, because a department's name is unique within its company

#### Scenario: A duplicate department name within one company

- **WHEN** a caller creates a department named `hrm` under a company that already has `HRM`
- **THEN** the API SHALL respond 409 and SHALL NOT create the record

#### Scenario: The same position name under two departments

- **WHEN** a caller creates a position named `ADMIN` under a department while another department already has one
- **THEN** the record SHALL be created, because a position's name is unique within its department

### Requirement: A referenced catalogue record cannot be deleted

Deleting a catalogue record that is still referenced SHALL be refused. The API
SHALL respond 409 and SHALL report how many records reference it, and the
catalogue record SHALL remain.

Employees SHALL count as referencing records for the company, position,
department, mess, SIMPER permit type, and SIMPER qualification code catalogues.

A child catalogue record SHALL count as a referencing record for its parent:
departments SHALL count for their company, and positions SHALL count for their
department. Deleting a parent SHALL NOT delete, reassign, or orphan its children.

#### Scenario: Delete a referenced record

- **WHEN** a caller attempts to delete a unit class that forty units reference
- **THEN** the API SHALL respond 409, SHALL report the referencing count, and the class SHALL remain

#### Scenario: Delete a catalogue record referenced by employees

- **WHEN** a caller attempts to delete a department, mess, permit type, or qualification code that employees reference
- **THEN** the API SHALL respond 409, SHALL report the referencing count, and the record SHALL remain

#### Scenario: Delete a company that has departments

- **WHEN** a caller attempts to delete a company that departments belong to
- **THEN** the API SHALL respond 409, SHALL report how many departments reference it, and the company SHALL remain

#### Scenario: Delete a department that has positions

- **WHEN** a caller attempts to delete a department that positions belong to
- **THEN** the API SHALL respond 409, SHALL report how many positions reference it, and the department SHALL remain

#### Scenario: Delete an unreferenced record

- **WHEN** a caller holding `manage` deletes a catalogue record that nothing references
- **THEN** the record SHALL be removed

#### Scenario: Deletion never cascades to referencing records

- **WHEN** a deletion of a referenced catalogue record is attempted
- **THEN** no referencing record SHALL be deleted, altered, or left with an unresolvable reference
