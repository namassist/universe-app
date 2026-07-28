## MODIFIED Requirements

### Requirement: Master data can be exported as a spreadsheet

Every master catalogue, the unit registry, and the employee records SHALL be
exportable as a spreadsheet by a caller holding `view` on the corresponding
menu.

The exported columns SHALL match the columns the corresponding import accepts,
so an exported file can be edited and imported back without restructuring.

#### Scenario: Export a catalogue

- **WHEN** a caller holding `view` on a master menu requests an export
- **THEN** the API SHALL respond with a spreadsheet containing that catalogue's records

#### Scenario: Export employees

- **WHEN** a caller holding `view` on `employees` requests an export
- **THEN** the API SHALL respond with a spreadsheet containing the employee records the caller's scope permits

#### Scenario: Export round-trips into import

- **WHEN** an exported file is submitted to the corresponding import without modification
- **THEN** the preview SHALL report no new records, no changed records, and no errors

#### Scenario: The downloaded file is intact

- **WHEN** a caller downloads an export in the browser
- **THEN** the file SHALL open in a spreadsheet application without corruption

#### Scenario: Export without a view grant

- **WHEN** a caller without `view` on the menu requests its export
- **THEN** the API SHALL respond 403

## ADDED Requirements

### Requirement: Employees are an import target keyed on NIK

Employees SHALL be importable by spreadsheet through the same preview-then-commit
sequence as the catalogues and the unit registry, governed by `manage` on
`employees`.

Rows SHALL be keyed on NIK: a NIK that matches no employee SHALL be previewed as
a creation, and a NIK that matches an existing employee SHALL be previewed as an
update naming the fields it would change.

#### Scenario: Preview reports creations and updates

- **WHEN** a caller uploads an employee spreadsheet for validation
- **THEN** the API SHALL return a preview marking each row as new, updated, or unchanged, listing the fields each update would change, and SHALL NOT persist anything

#### Scenario: Re-uploading a corrected file updates rather than duplicates

- **WHEN** a spreadsheet containing NIKs that already exist is committed
- **THEN** those employees SHALL be updated and no duplicate employee SHALL be created

#### Scenario: Duplicate NIK within one file

- **WHEN** a spreadsheet contains the same NIK on two rows
- **THEN** validation SHALL report an error for the row and the file SHALL NOT be committable until resolved

#### Scenario: Import without manage

- **WHEN** a caller holding only `view` on `employees` attempts a template download, validation, or commit
- **THEN** the API SHALL respond 403

### Requirement: SIMPER qualification codes import as one multi-valued column

An employee's qualification codes SHALL be carried by a single spreadsheet
column holding a separated list, rather than by one column per code, so the
file's width does not change when the catalogue grows.

Each listed code SHALL be resolved to a catalogue record, matched ignoring case
and surrounding whitespace like every other catalogue reference.

#### Scenario: Several codes in one cell

- **WHEN** a row carries several qualification codes in the skills column, separated by the defined separator
- **THEN** the employee SHALL be assigned each of those codes

#### Scenario: An empty skills cell

- **WHEN** a row carries no qualification codes
- **THEN** the employee SHALL be imported with no skills rather than being reported as an error

#### Scenario: The same code twice in one cell

- **WHEN** a row lists the same qualification code more than once
- **THEN** the employee SHALL hold that code once

### Requirement: An employee import never creates a SIMPER qualification code

The qualification code catalogue SHALL be excluded from the pending-addition
offer that the other referenced catalogues receive. A row naming a qualification
code that no record matches SHALL fail, reported by row number, and no
qualification code SHALL be created — regardless of the caller's grants on
`kode-simper`.

The employee import's other catalogue references — company, position,
department, mess, and SIMPER permit type — SHALL follow the general rule and be
offered for creation subject to the caller's `manage` grant on each.

The reason SHALL be stated in the row's issue text rather than left as a bare
"not found", because five columns offering an addition and one refusing it
otherwise reads as a defect.

#### Scenario: An unknown qualification code fails the row

- **WHEN** an employee row names a qualification code that no catalogue record matches, and the caller holds `manage` on `kode-simper`
- **THEN** the row SHALL be reported as an error with its row number, and no qualification code SHALL be created

#### Scenario: The refusal explains itself

- **WHEN** a row is failed for an unresolved qualification code
- **THEN** the issue text SHALL say that qualification codes are never created by import and SHALL direct the caller to the catalogue's own menu

#### Scenario: The other references are still offered

- **WHEN** an employee row names a position that does not exist and the caller may add positions
- **THEN** the position SHALL be listed as a pending addition and the row SHALL be a warning rather than an error

#### Scenario: An unresolved reference the caller cannot manage

- **WHEN** an employee row names a mess that does not exist and the caller holds no `manage` on `mess`
- **THEN** the row SHALL be reported as an error and no mess SHALL be created
