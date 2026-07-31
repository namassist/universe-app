# master-data Specification

## Purpose

The catalogues the rest of the UNIVERSE platform matches against: the eleven
master kinds and their per-kind record shapes, how names are normalised and kept
unique, what deactivating a record means as against deleting one, the
referential protection that keeps a referencing record from being orphaned, and
the rule that every screen offering a master value reads it from the API rather
than from a compiled-in array.

Eight of the kinds are flat lookup lists. The other three form the organisation
chain — a company owns departments, a department owns positions — so for those,
uniqueness, identity, and deletion are all read against the parent rather than
against the catalogue as a whole.

## Requirements

### Requirement: The master catalogues are persisted records

The system SHALL persist eleven master catalogues as database records: unit types
(`jenis-unit`), unit models (`model-unit`), unit brands (`merk-unit`), unit
classes (`kelas-unit`), SIMPER permit types (`simper`), SIMPER qualification
codes (`kode-simper`), departments (`departemen`), work areas (`area-kerja`),
mess (`mess`), companies (`perusahaan`), and positions (`jabatan`).

Every catalogue record SHALL carry an identifier, a name, an active flag, and a
creation timestamp. Records created, edited, or deleted through the API SHALL
survive a page reload and SHALL be visible to every other caller immediately.

#### Scenario: Create a catalogue record

- **WHEN** a caller holding `manage` on the catalogue's menu creates a record with a name
- **THEN** the record SHALL be persisted, SHALL be returned with a generated identifier, and SHALL appear in subsequent list responses

#### Scenario: Edit a catalogue record

- **WHEN** a caller holding `manage` on the catalogue's menu changes a record's name or fields
- **THEN** the change SHALL be persisted and SHALL be visible to every caller on the next read

#### Scenario: Records survive a reload

- **WHEN** a record is created and the client is reloaded
- **THEN** the record SHALL still be present, with no dependence on client-side state

#### Scenario: Unknown catalogue kind

- **WHEN** a caller requests a catalogue kind that is not one of the eleven defined kinds
- **THEN** the API SHALL respond 422 and SHALL NOT create or return any record

#### Scenario: The two added catalogues need no new route

- **WHEN** the company and position catalogues are requested
- **THEN** they SHALL be served by the same generic catalogue route as the other kinds, with no handler of their own

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

### Requirement: A work area has a defined type

A work area SHALL carry a type of `Mining` or `Non Mining`. The permitted values
SHALL be defined in the shared contracts so the database, the API schema, and
the client cannot drift.

#### Scenario: Valid area type

- **WHEN** a caller creates a work area with type `Mining`
- **THEN** the record SHALL be persisted with that type

#### Scenario: Invalid area type rejected

- **WHEN** a caller creates a work area with a type outside the defined values
- **THEN** the API SHALL respond 422 and SHALL NOT create the record

### Requirement: SIMPER permit type and SIMPER qualification code are separate catalogues

The system SHALL maintain SIMPER permit types and SIMPER qualification codes as
two distinct catalogues with two distinct menus.

The `simper` catalogue SHALL hold permit types — whether a person may operate at
all — such as `F` (Full permit) and `P` (Probation). The `kode-simper` catalogue
SHALL hold qualification codes — which units a person is qualified to operate —
such as `EXC 2600` and `OHT 777`.

A unit's qualification requirement SHALL reference the `kode-simper` catalogue
and SHALL NOT reference the `simper` catalogue.

#### Scenario: Qualification codes are managed independently

- **WHEN** a caller holding `manage` on `kode-simper` creates a qualification code
- **THEN** the code SHALL be persisted and SHALL be selectable as a unit's qualification requirement

#### Scenario: Permit types remain their own catalogue

- **WHEN** a caller reads the `simper` catalogue
- **THEN** the response SHALL contain permit types only and SHALL NOT contain qualification codes

#### Scenario: The qualification catalogue is not derived

- **WHEN** every unit referencing a qualification code is deleted
- **THEN** the qualification code SHALL remain in its catalogue

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

### Requirement: Deactivating a record hides it from selection without invalidating references

A catalogue record SHALL carry an active flag. An inactive record SHALL be
excluded from the options offered when selecting a value, and SHALL remain
visible in its own management screen.

Deactivating a record SHALL NOT invalidate, alter, or remove any existing
reference to it.

#### Scenario: Inactive record excluded from selection

- **WHEN** a record is deactivated and a caller requests the catalogue for selection purposes
- **THEN** the inactive record SHALL be absent from the returned options

#### Scenario: Inactive record still listed for management

- **WHEN** a record is deactivated and a caller lists the catalogue in its management screen
- **THEN** the record SHALL be present and SHALL be marked inactive

#### Scenario: Existing references survive deactivation

- **WHEN** a unit class referenced by units is deactivated
- **THEN** those units SHALL keep their class and SHALL continue to resolve it for display

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

### Requirement: Catalogue access is governed by the menu that owns it

Every catalogue route SHALL declare the menu slug and mode it requires. Reading
a catalogue SHALL require `view` on that catalogue's menu; creating, editing, or
deleting SHALL require `manage` on it.

A grant on one catalogue's menu SHALL NOT authorize any other catalogue.

#### Scenario: Read with view grant

- **WHEN** a caller holding `view` on `kelas-unit` lists the unit-class catalogue
- **THEN** the API SHALL respond 200

#### Scenario: Write with only view grant

- **WHEN** a caller holding only `view` on `kelas-unit` attempts to create a unit class
- **THEN** the API SHALL respond 403 and SHALL NOT create the record

#### Scenario: Grant on a different catalogue does not carry over

- **WHEN** a caller holding `manage` on `kelas-unit` but no grant on `departemen` attempts to create a department
- **THEN** the API SHALL respond 403

#### Scenario: Unauthenticated caller

- **WHEN** a caller with no session requests any catalogue route
- **THEN** the API SHALL respond 401

### Requirement: The master menus read and write the API

The web application's master menus SHALL obtain their rows from the API rather
than from module-scope sample data, and their create, edit, and delete actions
SHALL persist through the API.

A successful mutation SHALL invalidate the affected query so the list reflects
the change without a full page reload. A failed mutation SHALL surface the
API's message and SHALL leave the list unchanged.

#### Scenario: List reflects server state

- **WHEN** a master menu is opened
- **THEN** the rows displayed SHALL come from the API

#### Scenario: Successful mutation refreshes the list

- **WHEN** a record is created through a master menu
- **THEN** the list SHALL show it without a full page reload

#### Scenario: Rejected mutation reports the reason

- **WHEN** a create is refused because the name duplicates an existing record
- **THEN** the screen SHALL surface the API's message and the list SHALL be unchanged

#### Scenario: A caller without manage sees no write controls

- **WHEN** a caller holding only `view` opens a master menu
- **THEN** the add, edit, and delete controls SHALL NOT be rendered, and the API SHALL refuse those operations independently

### Requirement: Master catalogues are the single source of selectable values

Every screen offering a master value for selection SHALL obtain it from the API,
including screens whose own records are not yet persisted.

#### Scenario: A new value appears everywhere it is offered

- **WHEN** a work area is added through the master menu
- **THEN** it SHALL appear in every screen that offers work areas for selection, without a code change or redeploy

#### Scenario: A new company appears in the employee form

- **WHEN** a company is added through the master menu
- **THEN** it SHALL be offered by the employee form without a code change or redeploy

#### Scenario: No screen reads a static master module

- **WHEN** the application is built
- **THEN** no module SHALL export a hardcoded array of unit, work-area, department, mess, company, or position values for selection

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
