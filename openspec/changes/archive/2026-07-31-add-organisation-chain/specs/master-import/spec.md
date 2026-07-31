## ADDED Requirements

### Requirement: A hierarchical catalogue sheet carries its parent columns

The sheet for a catalogue that has a parent SHALL carry a column for each
ancestor, ordered outermost first, before the record's own columns.

The department sheet SHALL carry a company column. The position sheet SHALL carry
a company column and a department column. The company sheet SHALL carry its code
column, and the position sheet SHALL carry its fleet-allocation column, so an
export of either round-trips into its import without restructuring.

The parent columns SHALL be required on every row. A row SHALL NOT inherit a
parent from the row above it, from a sheet-level heading, or from the caller's
own department.

#### Scenario: The position sheet names both ancestors

- **WHEN** a caller exports or downloads a template for the position catalogue
- **THEN** the sheet SHALL carry a company column and a department column ahead of the position's own columns

#### Scenario: A row with a blank parent is refused

- **WHEN** an imported department row leaves the company column empty
- **THEN** the row SHALL be reported as an error naming the company column, and SHALL NOT be imported

#### Scenario: A parent is not inherited from the previous row

- **WHEN** an imported position row leaves the department column empty while the row above names one
- **THEN** the row SHALL be refused rather than filed under the previous row's department

#### Scenario: The fleet flag round-trips

- **WHEN** a position export is submitted to the position import without modification
- **THEN** the preview SHALL report no changed records, including for positions whose fleet flag is set

### Requirement: A hierarchical row is matched on its whole path, not its name

For a catalogue with a parent, an imported row SHALL be matched against existing
records on its ancestor path together with its name, compared without regard to
case. A row SHALL be reported as an edit only when a record exists under the same
parent.

A row whose name matches an existing record under a **different** parent SHALL be
reported as a new record, not as a change to that record. An import SHALL NOT be
capable of moving a department to another company or a position to another
department.

#### Scenario: The same name under a different parent is a new record

- **WHEN** an imported position row names `ADMIN` under one department while an `ADMIN` exists under another
- **THEN** the preview SHALL report the row as a new record, and the existing position SHALL keep its department

#### Scenario: A matching path is an edit

- **WHEN** an imported position row names an existing position under the same company and department, with a changed description
- **THEN** the preview SHALL report the row as a change to that record

#### Scenario: An import never moves a record between parents

- **WHEN** any hierarchical import is committed
- **THEN** no existing record's parent SHALL be changed by it

### Requirement: A unit row resolves its department only where the name is unambiguous

The unit sheet SHALL keep its single department column — a unit sheet names no
company, because a unit's company is not a fact the fleet records. A unit row's
department SHALL therefore resolve by name only while exactly one department
carries that name.

A department name held by more than one company SHALL refuse the row with a
message naming the companies, rather than resolving to any of them. A row whose
department cell repeats the unit's **own current** department SHALL keep that
department by its identifier, so an untouched export re-imports cleanly even
where its name has since become ambiguous.

A department SHALL never be created from a unit import, whatever the caller's
grants: the sheet cannot name the company a new department would belong to.

#### Scenario: An ambiguous department name refuses the row

- **WHEN** an imported unit row names a department held by two companies, and the unit is not already in either
- **THEN** the row SHALL be reported as an error naming both companies, and SHALL NOT be imported

#### Scenario: An untouched export still round-trips

- **WHEN** a unit export is re-imported while another company has since created a same-named department
- **THEN** each row SHALL keep its unit's own department, and the preview SHALL report it unchanged

#### Scenario: An unknown department refuses the row at any grant

- **WHEN** an imported unit row names a department no record matches, and the caller holds `manage` on the department catalogue
- **THEN** the row SHALL be reported as an error, the department SHALL NOT join the pending additions list, and none SHALL be created

### Requirement: An employee row resolves its department through its company

An imported employee row's department SHALL be resolved within the company the
row names, and its position SHALL be resolved within that department.

A row naming a department that exists under a different company, or a position
that exists under a different department, SHALL be reported as an error
identifying which pairing failed — not resolved to the same-named record
elsewhere in the organisation.

#### Scenario: A department under the wrong company fails the row

- **WHEN** an imported employee row names a company and a department that belongs to a different company
- **THEN** the row SHALL be reported as an error naming the department column and stating that it does not belong to the named company, and SHALL NOT be imported

#### Scenario: A position outside the named department fails the row

- **WHEN** an imported employee row names a position that exists under a department other than the one the row names
- **THEN** the row SHALL be reported as an error naming the position column, and SHALL NOT be imported

#### Scenario: The whole chain resolves

- **WHEN** an imported employee row names a company, a department under it, and a position under that department
- **THEN** the row SHALL resolve all three references and SHALL be importable

## MODIFIED Requirements

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

An unresolved **parent** SHALL be an exception: a value naming a company or a
department that no record matches SHALL be reported as an error refusing the row,
and SHALL NOT join the pending additions list. Creating a parent from a child
row's spelling produces a second organisation that looks genuine, and files the
rows that named it correctly into a different tree from the rows that did not.
The message SHALL identify which ancestor failed to resolve.

This applies to imports whose rows carry catalogue references. A catalogue's own
import references nothing except its parents, so its pending list SHALL always be
empty.

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

#### Scenario: An unresolved company refuses the row

- **WHEN** an imported department row names a company that does not exist
- **THEN** the row SHALL be reported as an error naming the company, the company SHALL NOT appear in the pending additions list, and no company SHALL be created on confirmation

#### Scenario: An unresolved department refuses the row

- **WHEN** an imported position or employee row names a department that does not exist under the company it names
- **THEN** the row SHALL be reported as an error naming the department, and no department SHALL be created

#### Scenario: A catalogue import has nothing to resolve

- **WHEN** a master catalogue's own import is previewed
- **THEN** the pending additions list SHALL be empty
