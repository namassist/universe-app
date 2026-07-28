## MODIFIED Requirements

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

#### Scenario: A work area carries its type

- **WHEN** a caller reads the work-area catalogue
- **THEN** each record SHALL include a `type` field whose value is one of the defined area types

#### Scenario: A unit class carries its description

- **WHEN** a caller reads the unit-class catalogue
- **THEN** each record SHALL include a `description` field

#### Scenario: A company carries its description

- **WHEN** a caller reads the company catalogue
- **THEN** each record SHALL include a `description` field

#### Scenario: No positional fields are exposed

- **WHEN** the OpenAPI document is generated
- **THEN** no catalogue response schema SHALL contain fields named positionally rather than by meaning

### Requirement: A referenced catalogue record cannot be deleted

Deleting a catalogue record that is still referenced SHALL be refused. The API
SHALL respond 409 and SHALL report how many records reference it, and the
catalogue record SHALL remain.

Employees SHALL count as referencing records for the company, position,
department, mess, SIMPER permit type, and SIMPER qualification code catalogues.

#### Scenario: Delete a referenced record

- **WHEN** a caller attempts to delete a unit class that forty units reference
- **THEN** the API SHALL respond 409, SHALL report the referencing count, and the class SHALL remain

#### Scenario: Delete a catalogue record referenced by employees

- **WHEN** a caller attempts to delete a department, mess, permit type, or qualification code that employees reference
- **THEN** the API SHALL respond 409, SHALL report the referencing count, and the record SHALL remain

#### Scenario: Delete an unreferenced record

- **WHEN** a caller holding `manage` deletes a catalogue record that nothing references
- **THEN** the record SHALL be removed

#### Scenario: Deletion never cascades to referencing records

- **WHEN** a deletion of a referenced catalogue record is attempted
- **THEN** no referencing record SHALL be deleted, altered, or left with an unresolvable reference

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
