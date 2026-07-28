# master-import Specification

## Purpose

Spreadsheet movement in and out of the master catalogues, the unit registry, and
the employee records:
export whose columns round-trip back into import, the preview-then-commit shape
that writes nothing until the caller approves, how a row naming a value that no
catalogue holds is disclosed and confirmed rather than either created silently
or refused outright, the grants that keep an import from writing into a
catalogue the caller may not manage, the atomicity of a commit, and the
permissions that govern both directions.

## Requirements

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

### Requirement: Catalogue values are matched without regard to case or surrounding whitespace

An imported row's catalogue references SHALL be matched ignoring case and
leading and trailing whitespace — the same comparison the catalogue's uniqueness
index enforces — so a file whose casing differs from the stored records imports
successfully and only a genuine misspelling misses.

#### Scenario: Different casing still matches

- **WHEN** an imported row names a catalogue value that differs from the stored record only in case or surrounding whitespace
- **THEN** the row SHALL resolve to the existing record and SHALL NOT be reported as an error

#### Scenario: Errors are reported alongside valid rows

- **WHEN** a file contains both importable rows and rows that cannot be imported
- **THEN** the preview SHALL report both, and the caller SHALL be able to see which rows fail before approving

### Requirement: An unresolved catalogue value is offered for creation, never created silently

When an imported row names a catalogue value that no record matches, the value
SHALL NOT appear in the catalogue as a side effect of the import. It SHALL
instead be disclosed and confirmed:

- the row SHALL be reported as a warning naming the column, the value, and that
  it would be added — distinct in severity from a row that cannot be imported at
  all;
- every distinct unresolved value SHALL be collected into a list of pending
  catalogue additions, each naming its catalogue, the value as typed, and **how
  many rows asked for it**, so a single typo is distinguishable from a value the
  fleet genuinely uses;
- nothing SHALL be written until the caller confirms.

Where two rows name the same value differing only in case, they SHALL count as
one addition, and the first spelling in the file SHALL be the one created.

This applies to imports whose rows carry catalogue references. A catalogue's own
import references nothing, so its pending list SHALL always be empty.

#### Scenario: An unresolved value is disclosed rather than written

- **WHEN** an imported unit row names a unit class that does not exist and the caller may add unit classes
- **THEN** the preview SHALL report the row as a warning, SHALL list the class as a pending addition with the number of rows that named it, and SHALL create nothing

#### Scenario: Confirmation is required before anything is added

- **WHEN** a caller previews a file with pending catalogue additions and does not approve it
- **THEN** no catalogue record SHALL be created

#### Scenario: The same value on many rows is one addition

- **WHEN** twelve rows name the same unit model that does not exist
- **THEN** the pending list SHALL carry one entry for that model, reporting twelve rows

#### Scenario: A near-duplicate is flagged but not refused

- **WHEN** an unresolved value closely resembles a record the catalogue already holds
- **THEN** the warning SHALL name the existing record so the caller can tell a misspelling from a genuinely new value, and the row SHALL NOT be refused on that ground alone

#### Scenario: A catalogue import has nothing to resolve

- **WHEN** a master catalogue's own import is previewed
- **THEN** the pending additions list SHALL be empty

### Requirement: Creating a catalogue value through an import requires manage on that catalogue

An import SHALL NOT be a way around a master catalogue's own permissions. The
grant that authorises the import target SHALL NOT authorise writing into the
catalogues its rows reference; each referenced catalogue SHALL be authorised
separately by `manage` on the menu that owns it.

Where the caller may not add to a referenced catalogue, an unresolved value in
that column SHALL fail its row, reported by row number with an issue naming the
column and the value, and no record SHALL be created.

The permissions SHALL be re-checked when the import is committed, against the
file as re-parsed at that moment, so a client's confirmation is advisory rather
than authoritative.

#### Scenario: Unresolved value in a catalogue the caller cannot manage

- **WHEN** an imported unit row names a department that does not exist and the caller holds no `manage` on `departemen`
- **THEN** the row SHALL be reported as an error with its row number, the issue SHALL name the column and the value, and no department SHALL be created

#### Scenario: One import, two catalogues, one grant

- **WHEN** a caller may add unit models but not departments, and a file carries unresolved values in both columns
- **THEN** the model SHALL be offered as a pending addition and the department row SHALL fail

#### Scenario: The commit re-checks rather than trusting the preview

- **WHEN** a commit is submitted
- **THEN** the file SHALL be re-parsed and the permissions behind every pending addition SHALL be re-evaluated, and the write SHALL follow that evaluation rather than the preview the client returned

### Requirement: A commit is applied in full or not at all

Committing an import SHALL be atomic. If any part of the write fails, no part of
that file SHALL remain applied.

The catalogue records created to satisfy a file's references SHALL be written
inside the same transaction as the rows that referenced them, so a run that
fails partway cannot leave a catalogue holding values no record ended up using.

The commit response SHALL report how many catalogue records were created,
separately from the records created and updated in the import target, so the
additions the caller confirmed can be checked against what actually landed.

#### Scenario: A failure during commit

- **WHEN** a commit fails partway through
- **THEN** no record from that file SHALL remain created or changed, and the API SHALL report the failure

#### Scenario: A failed commit leaves no orphaned catalogue values

- **WHEN** a commit that would have added catalogue values fails partway through
- **THEN** none of those catalogue records SHALL remain

#### Scenario: A successful commit

- **WHEN** a commit succeeds
- **THEN** every previewed create and change SHALL be applied

#### Scenario: The commit reports what it added to the catalogues

- **WHEN** a commit that carried pending catalogue additions succeeds
- **THEN** the response SHALL report the number of catalogue records created, apart from the counts of records created and updated

### Requirement: Import errors and warnings are reported in the established shape

Rows that cannot be imported SHALL be reported using the same per-row error
shape already used by the account and roster imports, so the results table is
consistent across every import in the product.

Rows that will import, but only because something is to be added to a catalogue
first, SHALL use that same shape at a lower severity, so an operator reads one
list of everything worth looking at rather than reconciling two tables.

Only rows reported at the blocking severity SHALL prevent a commit. A file whose
only remarks are warnings SHALL remain committable.

#### Scenario: Error row shape

- **WHEN** an import preview reports a failed row
- **THEN** the row SHALL carry its row identifier, the offending value, a description of the issue, and a severity indicator

#### Scenario: A warning does not block the commit

- **WHEN** a preview reports warnings but no blocking errors
- **THEN** the file SHALL remain committable

#### Scenario: A blocking error prevents the commit

- **WHEN** a preview reports any blocking error
- **THEN** the commit SHALL be refused and nothing from the file SHALL be written

#### Scenario: Consistent presentation

- **WHEN** an import result is rendered
- **THEN** it SHALL use the same results presentation as the existing account and roster imports, with errors and warnings distinguished by severity rather than separated into different tables

### Requirement: Import is governed by manage on the target menu

Previewing and committing an import SHALL require `manage` on the menu that owns
the target data.

#### Scenario: Import with only view grant

- **WHEN** a caller holding only `view` on a master menu attempts to preview an import for it
- **THEN** the API SHALL respond 403

#### Scenario: Import controls hidden without manage

- **WHEN** a caller holding only `view` opens a master menu
- **THEN** the import control SHALL NOT be rendered, and the API SHALL refuse the operation independently

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
