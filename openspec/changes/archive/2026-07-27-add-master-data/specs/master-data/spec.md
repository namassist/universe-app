## ADDED Requirements

### Requirement: The master catalogues are persisted records

The system SHALL persist nine master catalogues as database records: unit types
(`jenis-unit`), unit models (`model-unit`), unit brands (`merk-unit`), unit
classes (`kelas-unit`), SIMPER permit types (`simper`), SIMPER qualification
codes (`kode-simper`), departments (`departemen`), work areas (`area-kerja`),
and mess (`mess`).

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

- **WHEN** a caller requests a catalogue kind that is not one of the nine defined kinds
- **THEN** the API SHALL respond 422 and SHALL NOT create or return any record

### Requirement: Each catalogue carries only the fields its screen needs

A catalogue's record shape SHALL be declared per kind rather than through
positional fields shared across kinds. The API response schema for a kind SHALL
name that kind's fields explicitly, so the generated OpenAPI document describes
each catalogue accurately.

Unit types, unit models, unit brands, and mess SHALL carry a name only. Unit
classes, SIMPER permit types, SIMPER qualification codes, and departments SHALL
additionally carry a description. Work areas SHALL additionally carry a type.

#### Scenario: A work area carries its type

- **WHEN** a caller reads the work-area catalogue
- **THEN** each record SHALL include a `type` field whose value is one of the defined area types

#### Scenario: A unit class carries its description

- **WHEN** a caller reads the unit-class catalogue
- **THEN** each record SHALL include a `description` field

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
is stored. Within a catalogue, names SHALL be unique when compared without
regard to case.

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

#### Scenario: Delete a referenced record

- **WHEN** a caller attempts to delete a unit class that forty units reference
- **THEN** the API SHALL respond 409, SHALL report the referencing count, and the class SHALL remain

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

#### Scenario: No screen reads a static master module

- **WHEN** the application is built
- **THEN** no module SHALL export a hardcoded array of unit, work-area, department, or mess values for selection
