## ADDED Requirements

### Requirement: Units are persisted records

The system SHALL persist units as database records. A unit SHALL carry a unit
code, a serial number, an engine brand, a description, a Fit To Work flag, an
active flag, and optional standby and breakdown flags, in addition to the
catalogue references defined below.

A unit code SHALL be unique across the registry.

#### Scenario: Create a unit

- **WHEN** a caller holding `manage` on `database-unit` creates a unit with a code and its catalogue references
- **THEN** the unit SHALL be persisted and SHALL appear in subsequent list responses

#### Scenario: Duplicate unit code rejected

- **WHEN** a caller creates a unit whose code already exists
- **THEN** the API SHALL respond 409 and SHALL NOT create the unit

#### Scenario: Edit a unit

- **WHEN** a caller holding `manage` changes a unit's fields
- **THEN** the change SHALL be persisted and SHALL be visible on the next read

#### Scenario: Unit list is served from the database

- **WHEN** the Database Unit screen is opened
- **THEN** the rows displayed SHALL come from the API and SHALL survive a reload

### Requirement: A unit references its catalogues by key

A unit's class, type, model, brand, SIMPER qualification code, and department
SHALL be stored as references to their catalogue records, not as free text.

A unit SHALL NOT be persisted with a catalogue value that does not exist in the
corresponding catalogue.

#### Scenario: Valid catalogue references accepted

- **WHEN** a caller creates a unit whose class, type, model, brand, qualification code, and department all exist in their catalogues
- **THEN** the unit SHALL be persisted

#### Scenario: Unknown catalogue value rejected

- **WHEN** a caller creates a unit naming a unit class that does not exist
- **THEN** the API SHALL respond with a validation error, SHALL NOT create the unit, and SHALL NOT create the class

#### Scenario: Renaming a catalogue record propagates

- **WHEN** a unit class is renamed
- **THEN** every unit referencing it SHALL display the new name with no per-unit update

#### Scenario: No unit can hold an unresolvable catalogue value

- **WHEN** any unit is read
- **THEN** each of its catalogue references SHALL resolve to an existing catalogue record

### Requirement: A unit's qualification requirement references the qualification catalogue

A unit's SIMPER requirement SHALL reference the `kode-simper` qualification
catalogue. It SHALL NOT reference the `simper` permit-type catalogue, and it
SHALL NOT be stored as free text.

#### Scenario: Qualification requirement is a reference

- **WHEN** a unit is created with a qualification requirement
- **THEN** the stored value SHALL be a reference to a `kode-simper` record

#### Scenario: Permit type is not accepted as a qualification

- **WHEN** a caller attempts to set a unit's qualification requirement to a permit-type record
- **THEN** the API SHALL reject it and SHALL NOT persist the unit

#### Scenario: A unit may have no qualification requirement

- **WHEN** a unit is created without a qualification requirement
- **THEN** the unit SHALL be persisted with that reference absent

### Requirement: A bus is a unit with a departure schedule

The system SHALL persist a bus departure schedule as a record referencing a unit
and carrying a departure time and an active flag. A unit SHALL have at most one
departure schedule.

The Bus menu SHALL offer only units whose type is `BUS` when a schedule is
created.

#### Scenario: Create a bus schedule

- **WHEN** a caller holding `manage` on `bus` creates a schedule for a unit of type `BUS` with a departure time
- **THEN** the schedule SHALL be persisted and SHALL appear in the Bus menu

#### Scenario: Duplicate schedule for the same unit rejected

- **WHEN** a caller creates a second schedule for a unit that already has one
- **THEN** the API SHALL respond 409 and SHALL NOT create the second schedule

#### Scenario: Only bus units are offered

- **WHEN** the Bus menu offers units for selection
- **THEN** only units whose type is `BUS` SHALL be offered

#### Scenario: No bus units exist

- **WHEN** no unit of type `BUS` exists
- **THEN** the Bus menu SHALL render an empty state and SHALL NOT offer any unit for selection

#### Scenario: A scheduled unit cannot be deleted

- **WHEN** a caller attempts to delete a unit that has a departure schedule
- **THEN** the API SHALL respond 409 and the unit SHALL remain

### Requirement: Unit registry access is governed by the database-unit menu

Reading units SHALL require `view` on `database-unit`; creating, editing, and
deleting units SHALL require `manage` on it. Bus schedules SHALL be governed by
the `bus` menu on the same terms.

#### Scenario: Read with view grant

- **WHEN** a caller holding `view` on `database-unit` lists units
- **THEN** the API SHALL respond 200

#### Scenario: Write with only view grant

- **WHEN** a caller holding only `view` on `database-unit` attempts to create a unit
- **THEN** the API SHALL respond 403

#### Scenario: Bus schedule governed separately

- **WHEN** a caller holding `manage` on `database-unit` but no grant on `bus` attempts to create a bus schedule
- **THEN** the API SHALL respond 403

### Requirement: Unit-derived selections come from the registry

Screens that offer units for selection SHALL derive those options from the unit
registry rather than from static data, including screens whose own records are
not yet persisted.

#### Scenario: Digger and hauler selections

- **WHEN** a screen offers digger units or non-digger units for selection
- **THEN** the options SHALL be derived from the persisted unit registry

#### Scenario: A newly created unit becomes selectable

- **WHEN** a unit is created through the Database Unit screen
- **THEN** it SHALL become available in every screen offering units of its kind, without a code change or redeploy
