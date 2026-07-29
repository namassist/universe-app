## ADDED Requirements

### Requirement: Roster is an import target whose sheet is shaped by the month

The roster SHALL be an import target, following the same two-step
preview-then-commit shape as the catalogue, unit, and employee targets.

Its sheet SHALL carry a fixed leading block of columns — line number, NIK, name,
department, and position — followed by one column per day of the month. Unlike
every other target, the number of columns SHALL therefore vary, and SHALL be
determined by the month stated for the upload rather than by a constant column
list.

Of the fixed block only the NIK SHALL be read. The line number, department, and
position SHALL be carried so that the sheet the API produces is the sheet a
planner already circulates, and SHALL NOT be validated against the register: the
department is decided by the caller's scope, and the position belongs to the
employee record.

A file whose count of day columns does not match the stated month SHALL be
rejected as a file-level failure, before any row is examined.

Rows SHALL be keyed on NIK, matched without regard to surrounding whitespace.

#### Scenario: Day columns match the month

- **WHEN** a file for a thirty-day month carries thirty day columns
- **THEN** the file SHALL be accepted for row-level validation

#### Scenario: Day column count disagrees with the month

- **WHEN** a file carrying thirty-one day columns is uploaded for a thirty-day month
- **THEN** the API SHALL refuse the file as a whole and SHALL NOT report per-row results

#### Scenario: A cell outside the roster vocabulary

- **WHEN** a day cell carries a value that is not a roster code
- **THEN** the preview SHALL report that row as a failed row, naming the day and the offending value

#### Scenario: An empty day cell

- **WHEN** a day cell is empty
- **THEN** the preview SHALL report that row as a failed row, because every day of the month must carry a code

### Requirement: The roster template is a department's own sheet

The template SHALL be produced for a stated month and a resolved department, and
SHALL arrive carrying that department's active employees — one row each, with
the day columns left empty for the planner to fill.

The department SHALL be resolved the same way the upload resolves it: from the
caller's own employee record, unless the caller's scope reaches every department,
in which case the caller SHALL state one and the API SHALL refuse the request
until it does.

Employees whose employment status is not active SHALL NOT be listed, because a
person who has left has no shifts to plan.

The template and the export of a stored document SHALL be the same shape, so
that a downloaded roster can be corrected and uploaded back without alteration.

#### Scenario: A template is offered for the stated month

- **WHEN** a caller requests the roster import template for a month
- **THEN** the template SHALL carry the fixed columns and exactly one column per day of that month

#### Scenario: A scoped caller's template lists their own department

- **WHEN** a caller whose scope names one department requests a template
- **THEN** the template SHALL list that department's active employees, and any department stated in the request SHALL be ignored

#### Scenario: An unscoped caller must choose a department

- **WHEN** a caller whose scope reaches every department requests a template without naming one
- **THEN** the API SHALL refuse the request and SHALL NOT produce a template

### Requirement: A roster import discloses approved revisions it would revert

Before a roster upload is committed, the preview SHALL report every approved
revision entry whose date the file covers and whose resulting code the file
would replace.

Each SHALL be reported at the non-blocking severity, naming the employee, the
date, and the change that would be undone. They SHALL NOT prevent the commit,
because reverting a day is sometimes what the operator intends.

#### Scenario: An approved revision would be reverted

- **WHEN** a file covers a date carrying an approved revision whose code differs from the file's cell
- **THEN** the preview SHALL report it at the non-blocking severity, naming the employee, the date, and the change that would be undone

#### Scenario: Disclosure does not block the commit

- **WHEN** a preview's only remarks are revisions that would be reverted
- **THEN** the file SHALL remain committable

#### Scenario: Matching revisions are not reported

- **WHEN** a file's cell for a revised date matches the code the approved revision produced
- **THEN** no remark SHALL be reported for it

#### Scenario: Each revision is named individually

- **WHEN** several approved revisions would be reverted
- **THEN** each SHALL be reported as its own row rather than folded into a count

### Requirement: A roster import never changes employment status, and says where the two disagree

A roster import SHALL NOT change any employee's employment status. Employment
status SHALL remain governed by the employee record alone, because a shifted
column in a spreadsheet would otherwise end the employment of everyone below it.

Where a row's codes and the employee's stored status contradict each other, the
preview SHALL report it at the non-blocking severity, naming the employee and the
date, so a person can resolve it on the employee screen.

#### Scenario: A termination code on an active employee

- **WHEN** a file rosters a day with a code meaning employment has ended, for an employee whose stored status is active
- **THEN** the preview SHALL report it at the non-blocking severity naming the employee and the date, and the employee's status SHALL remain active

#### Scenario: An inactive employee is still rostered for a shift

- **WHEN** a file rosters a shift code for an employee whose stored status is inactive
- **THEN** the preview SHALL report it at the non-blocking severity, and the row SHALL remain importable

#### Scenario: The commit does not touch employment status

- **WHEN** a file containing termination codes is committed
- **THEN** the roster days SHALL be written and no employee's status SHALL be modified

#### Scenario: The disagreement does not block the commit

- **WHEN** a preview's only remarks are contradictions between roster codes and stored status
- **THEN** the file SHALL remain committable

## MODIFIED Requirements

### Requirement: Import previews the outcome before anything is written

Importing SHALL be a two-step operation. The first step SHALL accept the
uploaded file and return a preview; nothing SHALL be written during it. The
second step SHALL write the previewed outcome only after the caller approves it.

The preview SHALL report the number of records to be created, the number to be
changed, and the number of rows that cannot be imported, together with the rows
themselves.

Where a target's row count is large enough that returning every row in one
response is impractical — the roster, whose month covers the whole workforce —
the preview SHALL return the full counts and the full set of failed and
non-blocking rows, and SHALL serve the accepted rows in pages requested from the
API. The pages SHALL describe the same file the counts describe.

The second step SHALL parse the uploaded file again rather than trusting a
preview returned by the client.

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

#### Scenario: A large preview is paged

- **WHEN** a preview covers more rows than one response can carry
- **THEN** the counts and every failed and non-blocking row SHALL be returned in full, and the accepted rows SHALL be requestable in pages

#### Scenario: The commit does not trust the preview

- **WHEN** a caller commits an import
- **THEN** the file SHALL be parsed again and the commit SHALL be decided by that parse, not by a preview supplied in the request
