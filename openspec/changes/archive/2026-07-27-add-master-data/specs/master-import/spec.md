## ADDED Requirements

### Requirement: Master data can be exported as a spreadsheet

Every master catalogue and the unit registry SHALL be exportable as a
spreadsheet by a caller holding `view` on the corresponding menu.

The exported columns SHALL match the columns the corresponding import accepts,
so an exported file can be edited and imported back without restructuring.

#### Scenario: Export a catalogue

- **WHEN** a caller holding `view` on a master menu requests an export
- **THEN** the API SHALL respond with a spreadsheet containing that catalogue's records

#### Scenario: Export round-trips into import

- **WHEN** an exported file is submitted to the corresponding import without modification
- **THEN** the preview SHALL report no new records, no changed records, and no errors

#### Scenario: The downloaded file is intact

- **WHEN** a caller downloads an export in the browser
- **THEN** the file SHALL open in a spreadsheet application without corruption

#### Scenario: Export without a view grant

- **WHEN** a caller without `view` on the menu requests its export
- **THEN** the API SHALL respond 403

### Requirement: Import previews the outcome before anything is written

Importing SHALL be a two-step operation. The first step SHALL accept the
uploaded file and return a preview; nothing SHALL be written during it. The
second step SHALL write the previewed outcome only after the caller approves it.

The preview SHALL report the number of records to be created, the number to be
changed, and the number of rows that cannot be imported, together with the rows
themselves.

#### Scenario: Preview writes nothing

- **WHEN** a caller uploads a file for preview
- **THEN** the API SHALL return the preview and the stored data SHALL be unchanged

#### Scenario: Preview reports what would change

- **WHEN** a file containing new and changed records is previewed
- **THEN** the response SHALL report each row as new or changed and SHALL list the fields that would change

#### Scenario: Commit applies the previewed outcome

- **WHEN** the caller approves a preview
- **THEN** the previewed records SHALL be created and updated, and the response SHALL report how many of each

#### Scenario: Abandoning a preview changes nothing

- **WHEN** a caller previews a file and does not approve it
- **THEN** the stored data SHALL remain unchanged

### Requirement: An unresolvable catalogue value fails its row rather than creating a record

When an imported row names a catalogue value that does not exist, that row SHALL
be reported as an error identified by its row number, and the named value SHALL
NOT be created.

Catalogue values SHALL be matched without regard to case and ignoring leading
and trailing whitespace, so a file whose casing differs from the catalogue
imports successfully.

#### Scenario: Misspelled catalogue value

- **WHEN** an imported unit row names a unit class that does not exist
- **THEN** the row SHALL be reported as an error with its row number, and no unit class SHALL be created

#### Scenario: Different casing still matches

- **WHEN** an imported row names a catalogue value that differs from the stored record only in case or surrounding whitespace
- **THEN** the row SHALL resolve to the existing record and SHALL NOT be reported as an error

#### Scenario: Errors are reported alongside valid rows

- **WHEN** a file contains both importable rows and rows with unresolvable values
- **THEN** the preview SHALL report both, and the caller SHALL be able to see which rows fail before approving

### Requirement: A commit is applied in full or not at all

Committing an import SHALL be atomic. If any part of the write fails, no part of
that file SHALL remain applied.

#### Scenario: A failure during commit

- **WHEN** a commit fails partway through
- **THEN** no record from that file SHALL remain created or changed, and the API SHALL report the failure

#### Scenario: A successful commit

- **WHEN** a commit succeeds
- **THEN** every previewed create and change SHALL be applied

### Requirement: Import errors are reported in the established shape

Rows that cannot be imported SHALL be reported using the same per-row error
shape already used by the account and roster imports, so the results table is
consistent across every import in the product.

#### Scenario: Error row shape

- **WHEN** an import preview reports a failed row
- **THEN** the row SHALL carry its row identifier, the offending value, a description of the issue, and a severity indicator

#### Scenario: Consistent presentation

- **WHEN** an import result is rendered
- **THEN** it SHALL use the same results presentation as the existing account and roster imports

### Requirement: Import is governed by manage on the target menu

Previewing and committing an import SHALL require `manage` on the menu that owns
the target data.

#### Scenario: Import with only view grant

- **WHEN** a caller holding only `view` on a master menu attempts to preview an import for it
- **THEN** the API SHALL respond 403

#### Scenario: Import controls hidden without manage

- **WHEN** a caller holding only `view` opens a master menu
- **THEN** the import control SHALL NOT be rendered, and the API SHALL refuse the operation independently
