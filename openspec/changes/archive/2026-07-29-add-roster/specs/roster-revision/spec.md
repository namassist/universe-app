## ADDED Requirements

### Requirement: A revision is a submission of many entries

The system SHALL persist a roster revision as a submission carrying an
identifier an operator can read, the roster document it applies to, the account
that submitted it, and the time it was submitted.

A submission SHALL hold one or more entries. Each entry SHALL identify one
employee, one date, the code being changed from, the code being changed to, and
the reason given.

An entry SHALL be required to carry a reason. A submission with no entries SHALL
be refused.

#### Scenario: Submit a revision

- **WHEN** a caller submits a revision carrying entries
- **THEN** the submission and its entries SHALL be persisted, and SHALL appear in subsequent list responses

#### Scenario: A submission must carry entries

- **WHEN** a caller submits a revision with no entries
- **THEN** the API SHALL respond 422 and SHALL NOT create the submission

#### Scenario: An entry must carry a reason

- **WHEN** an entry is submitted with no reason or an empty reason
- **THEN** the API SHALL respond 422 and SHALL NOT create the submission

#### Scenario: Records survive a reload

- **WHEN** a revision is submitted and the client is reloaded
- **THEN** the submission and its entries SHALL still be present, with no dependence on client-side state

### Requirement: Each entry is decided independently

An entry's status SHALL be pending, approved, or rejected, and SHALL be held on
the entry rather than on the submission. Deciding one entry SHALL NOT decide any
other entry of the same submission.

A submission's presentation SHALL be able to show more than one status at once,
because its entries may have been decided differently.

#### Scenario: Entries of one submission decided differently

- **WHEN** two entries of one submission are approved and a third is rejected
- **THEN** each entry SHALL carry its own status and the submission SHALL remain readable with all three

#### Scenario: A decided entry cannot be decided again

- **WHEN** a caller attempts to decide an entry that is already approved or rejected
- **THEN** the API SHALL respond 409 and SHALL NOT change the entry

#### Scenario: Deciding requires manage on approval

- **WHEN** a caller without `manage` on `roster-approval` attempts to decide an entry
- **THEN** the API SHALL respond 403 and SHALL NOT change the entry

### Requirement: An entry records the code it changes from

An entry SHALL store the code in force at the time it was submitted, rather than
resolving it when the decision is made.

Before applying a decision, the system SHALL compare the stored from-code with
the code currently in force. If they differ, the entry SHALL NOT be decided and
the API SHALL report the conflict naming both codes.

#### Scenario: From-code is captured at submission

- **WHEN** an entry is submitted
- **THEN** the code in force for that employee and date SHALL be stored on the entry

#### Scenario: A stale entry cannot be decided

- **WHEN** an entry is approved after the code in force has changed from the one it recorded
- **THEN** the API SHALL respond 409, SHALL name the recorded code and the current code, and SHALL NOT change the roster

### Requirement: Approving an entry writes the new code onto the roster

Approving an entry SHALL set the roster day of that employee and date, within
the active document, to the entry's to-code. The status change and the roster
write SHALL happen in one transaction.

The entry SHALL record who decided it and when. Rejecting an entry SHALL NOT
change the roster.

#### Scenario: Approval changes the roster

- **WHEN** an entry changing a day from one code to another is approved
- **THEN** the roster day SHALL carry the new code, and every subsequent read of the roster in force SHALL return it

#### Scenario: Approval is atomic

- **WHEN** the roster write of an approval fails
- **THEN** the entry SHALL remain pending and the roster SHALL be unchanged

#### Scenario: Rejection leaves the roster alone

- **WHEN** an entry is rejected
- **THEN** the roster day SHALL keep the code it already carried

#### Scenario: The decision is attributed

- **WHEN** an entry is decided
- **THEN** the entry SHALL record the deciding account and the time of the decision

#### Scenario: The submitter may also be the decider

- **WHEN** a caller holding `manage` on `roster-approval` decides an entry of a submission it submitted itself
- **THEN** the decision SHALL be accepted, and both the submitting account and the deciding account SHALL be recorded and returned so that the coincidence is visible

#### Scenario: An approved change is visible to allocation

- **WHEN** an entry changing a shift code to a non-shift code is approved
- **THEN** a subsequent read of who is scheduled for that shift on that date SHALL NOT include that employee

### Requirement: Rejecting requires a reason; approving may carry a note

Rejecting an entry SHALL require a reason, and SHALL be refused without one.
Approving an entry MAY carry a note, and SHALL be accepted without one.

Both SHALL be stored on the entry and returned with it.

#### Scenario: Rejection without a reason

- **WHEN** a caller rejects an entry without a reason
- **THEN** the API SHALL respond 422 and SHALL NOT change the entry

#### Scenario: Approval without a note

- **WHEN** a caller approves an entry with no note
- **THEN** the approval SHALL succeed

#### Scenario: The decision text is returned

- **WHEN** a decided entry is read
- **THEN** its reason or note SHALL be returned with it

### Requirement: A revision belongs to its document and is frozen with it

A submission SHALL belong to the roster document its entries apply to. When that
document is archived, its decided entries SHALL be retained unchanged as
history, and its entries still pending SHALL be rejected automatically within
the same transaction, carrying a decision text that states the system reason.

An entry belonging to an archived document SHALL NOT be decidable.

#### Scenario: Archiving rejects pending entries

- **WHEN** a document is archived because its month was uploaded again
- **THEN** every entry of that document still pending SHALL become rejected, with a decision text naming the re-upload as the reason

#### Scenario: Decided entries survive archiving

- **WHEN** a document is archived
- **THEN** its approved and rejected entries SHALL remain readable, unchanged

#### Scenario: A frozen entry cannot be decided

- **WHEN** a caller attempts to decide an entry belonging to an archived document
- **THEN** the API SHALL respond 409 and SHALL NOT change the entry

### Requirement: A revision targets a day the roster already carries

An entry SHALL reference a date the active document of its department covers. An
entry for a date outside that document's month, or for an employee the document
carries no row for, SHALL be refused.

A date already past and a date still to come SHALL both be permitted. The
system SHALL NOT impose any further limit on how far back or how far forward a
date may be.

#### Scenario: A past date is permitted

- **WHEN** an entry names a date earlier than today but within the document's month
- **THEN** the submission SHALL be accepted

#### Scenario: A future date is permitted

- **WHEN** an entry names a date later than today but within the document's month
- **THEN** the submission SHALL be accepted

#### Scenario: Date outside the document's month

- **WHEN** an entry names a date outside the month of the document it applies to
- **THEN** the API SHALL respond 422 and SHALL NOT create the submission

#### Scenario: No roster day to revise

- **WHEN** an entry names an employee and date the active document carries no row for
- **THEN** the API SHALL respond 422 and SHALL NOT create the submission

#### Scenario: To-code must be a known roster code

- **WHEN** an entry names a to-code outside the roster vocabulary
- **THEN** the API SHALL respond 422 and SHALL NOT create the submission

### Requirement: The employee an entry names is validated against the caller's scope

The employee an entry refers to SHALL be decided by the server. Where the
caller's scope permits naming an employee, the named value SHALL be validated
against the caller's scope predicate before anything is written. Where the
caller's scope identifies exactly one employee, the entry's employee SHALL be
resolved from the caller's own NIK and any named value SHALL have no effect.

Reading revisions SHALL be scoped by the same predicate, so that an operator
permitted only to view sees the revisions concerning itself.

#### Scenario: Dept scope cannot submit outside its department

- **WHEN** a `dept`-scoped caller submits an entry for an employee of another department
- **THEN** the API SHALL respond 403 or 404 and SHALL NOT create the submission

#### Scenario: Self scope cannot submit for another employee

- **WHEN** a `self`-scoped caller permitted to submit names an employee other than itself
- **THEN** the entry SHALL be recorded against the caller's own employee record, and the named value SHALL have no effect

#### Scenario: Revision lists are scoped

- **WHEN** a scoped caller lists revisions
- **THEN** only submissions whose entries fall within its scope SHALL be returned

#### Scenario: An operator reads its own revisions

- **WHEN** a `self`-scoped caller holding only `view` on revisions lists them
- **THEN** only entries naming that caller's own employee record SHALL be returned

### Requirement: The revision and approval screens read and write the API

The revision list, the revision form, and the approval queue SHALL be served by
the API. They SHALL NOT read compiled-in sample data, and a decision SHALL NOT
be reported as successful without a persisted result.

Codes offered by the revision form SHALL come from the shared roster vocabulary.

#### Scenario: A submitted revision persists

- **WHEN** an operator submits a revision and reloads
- **THEN** the submission SHALL be present in the list

#### Scenario: A decision persists

- **WHEN** an approver approves or rejects an entry and reloads
- **THEN** the entry SHALL carry the decided status, the deciding account, and the decision text

#### Scenario: No sample data remains

- **WHEN** the revision and approval screens are inspected
- **THEN** no submission, entry, or status SHALL originate from a compiled-in array

#### Scenario: The form offers only known codes

- **WHEN** the revision form's code list is rendered
- **THEN** every option SHALL be a code of the shared roster vocabulary

#### Scenario: The employee selector offers only reachable employees

- **WHEN** a scoped caller searches employees in the revision form
- **THEN** the options SHALL come from the scoped employee endpoint, and the server SHALL refuse an out-of-scope employee independently of what the form offered
