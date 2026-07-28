## MODIFIED Requirements

### Requirement: Bulk account provisioning by spreadsheet

The system SHALL allow an authorized caller to create and update accounts in
bulk by uploading a spreadsheet. The file MUST be parsed and validated on the
server, and nothing MUST be persisted before the caller confirms a preview.

#### Scenario: Template download

- **WHEN** an authorized caller requests the import template
- **THEN** the API SHALL return an `.xlsx` file whose columns are `nik`, `nama`, `email`, and `role`, and which contains no password column

#### Scenario: Validation preview

- **WHEN** an authorized caller uploads a spreadsheet for validation
- **THEN** the API SHALL return a preview marking each row as new or updated, listing the fields each update would change, together with per-row errors, and SHALL NOT persist anything

#### Scenario: Commit after confirmation

- **WHEN** the caller confirms a validated import
- **THEN** the API SHALL create the new accounts and update the existing ones as previewed

#### Scenario: Re-uploading a corrected file updates rather than duplicates

- **WHEN** a spreadsheet containing NIKs that already exist is committed
- **THEN** those accounts SHALL be updated and no duplicate accounts SHALL be created

#### Scenario: Duplicate NIK within one file

- **WHEN** a spreadsheet contains the same NIK on two rows
- **THEN** validation SHALL report an error for the row and the file SHALL NOT be committable until resolved

#### Scenario: Unknown role in a row

- **WHEN** a row names a role that does not exist
- **THEN** validation SHALL report an error for that row

#### Scenario: NIK not matching an employee fails its row

- **WHEN** a row carries a NIK that matches no employee record
- **THEN** validation SHALL report an error for that row identified by its row number, and the file SHALL NOT be committable until resolved

#### Scenario: Malformed file

- **WHEN** an uploaded file is not a readable spreadsheet, exceeds the size cap, or carries unrecognised columns
- **THEN** the API SHALL reject it with a validation error and SHALL NOT partially import it

#### Scenario: Unauthorized import

- **WHEN** a caller without `manage` on the `users` menu attempts a template download, validation, or commit
- **THEN** the API SHALL respond 403

### Requirement: Account identification by email or NIK

An account SHALL be identifiable by an email address, a NIK, or both. Each
value MUST be unique across accounts when present, and every account MUST carry
at least one of the two.

A NIK carried by an account SHALL match an employee record. The check SHALL be
enforced at the API boundary rather than by a database constraint, so that
deleting an employee does not remove an account and the rule can be relaxed per
route if an account that is not a person is ever needed.

#### Scenario: Login with email

- **WHEN** a caller submits an identifier matching an active account's email and the correct password
- **THEN** the API SHALL issue a session and respond 200

#### Scenario: Login with NIK

- **WHEN** a caller submits an identifier matching an active account's NIK and the correct password
- **THEN** the API SHALL issue a session and respond 200

#### Scenario: Account with neither email nor NIK is rejected

- **WHEN** an account is created with both email and NIK absent
- **THEN** the API SHALL reject the request with 422 and the database constraint SHALL prevent the row

#### Scenario: Account created with a NIK that matches no employee

- **WHEN** an account is created or edited with a NIK that no employee record carries
- **THEN** the API SHALL respond 422 and SHALL NOT persist the account, because an account whose NIK resolves to no employee has no departemen and would be scoped to an empty set

#### Scenario: The bootstrap superadmin is exempt

- **WHEN** the seed creates or restores the bootstrap superadmin account
- **THEN** it SHALL succeed regardless of whether an employee record carries its identifier, so that the account which recovers a misconfigured installation cannot itself be blocked by missing master data

#### Scenario: Wrong password

- **WHEN** a caller submits a known identifier with an incorrect password
- **THEN** the API SHALL respond 401 with a message that does not reveal whether the identifier exists

#### Scenario: Unknown identifier

- **WHEN** a caller submits an identifier matching no account
- **THEN** the API SHALL respond 401 with the same message and comparable timing as a wrong-password response

#### Scenario: Inactive account

- **WHEN** a caller submits correct credentials for an account whose `active` flag is false
- **THEN** the API SHALL respond 401 and SHALL NOT issue a session
