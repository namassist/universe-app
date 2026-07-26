# auth Specification

## Purpose

Authentication for the UNIVERSE platform: how an account is identified, how its
credentials are stored and rotated, how a session is issued, transported, and
expired for both browser and non-browser clients, and how a display device
becomes a registrable, revocable principal that is not a user account.

## Requirements

### Requirement: Account identification by email or NIK

An account SHALL be identifiable by an email address, a NIK, or both. Each
value MUST be unique across accounts when present, and every account MUST carry
at least one of the two.

#### Scenario: Login with email

- **WHEN** a caller submits an identifier matching an active account's email and the correct password
- **THEN** the API SHALL issue a session and respond 200

#### Scenario: Login with NIK

- **WHEN** a caller submits an identifier matching an active account's NIK and the correct password
- **THEN** the API SHALL issue a session and respond 200

#### Scenario: Account with neither email nor NIK is rejected

- **WHEN** an account is created with both email and NIK absent
- **THEN** the API SHALL reject the request with 422 and the database constraint SHALL prevent the row

#### Scenario: Wrong password

- **WHEN** a caller submits a known identifier with an incorrect password
- **THEN** the API SHALL respond 401 with a message that does not reveal whether the identifier exists

#### Scenario: Unknown identifier

- **WHEN** a caller submits an identifier matching no account
- **THEN** the API SHALL respond 401 with the same message and comparable timing as a wrong-password response

#### Scenario: Inactive account

- **WHEN** a caller submits correct credentials for an account whose `active` flag is false
- **THEN** the API SHALL respond 401 and SHALL NOT issue a session

### Requirement: Password storage

Passwords SHALL be stored only as argon2id hashes produced by `Bun.password`.
A password hash MUST NOT appear in any API response.

#### Scenario: Hash on write

- **WHEN** an account is created or its password changed
- **THEN** the stored value SHALL be an argon2id hash and the plaintext SHALL NOT be persisted or logged

#### Scenario: Hash never returned

- **WHEN** any endpoint returns an account representation
- **THEN** the response schema SHALL omit the password hash

### Requirement: Sessions are opaque and server-resolved

A session SHALL be a random opaque identifier resolved server-side against
Redis. The identifier MUST NOT encode identity, role, permissions, or scope.

#### Scenario: Session carries no authorization data

- **WHEN** a session identifier is inspected by its holder
- **THEN** it SHALL yield no role, permission, or scope information without a server lookup

#### Scenario: Unknown session identifier

- **WHEN** a request presents a session identifier absent from Redis
- **THEN** the API SHALL respond 401

### Requirement: One session store, two transports

A session SHALL be deliverable as an httpOnly cookie or as an
`Authorization: Bearer` header, both resolving to the same session record.

#### Scenario: Web login sets a cookie

- **WHEN** a browser client logs in successfully
- **THEN** the response SHALL set `universe_session` as httpOnly with `SameSite=Lax` and `Path=/`, marking it `Secure` according to explicit configuration rather than the environment name

#### Scenario: Non-browser login receives the identifier

- **WHEN** a client requests bearer delivery at login
- **THEN** the response body SHALL include the session identifier for use in an `Authorization: Bearer` header

#### Scenario: Both transports resolve identically

- **WHEN** the same session identifier arrives once as a cookie and once as a bearer header
- **THEN** the API SHALL resolve the same principal and permissions in both cases

### Requirement: Session expiry

A user session SHALL expire after a period of inactivity and SHALL have its
expiry extended by activity. A web session SHALL additionally expire a fixed
period after it was issued, regardless of activity.

#### Scenario: Idle expiry

- **WHEN** a session receives no request for longer than its configured idle window
- **THEN** the API SHALL respond 401 on the next request and the Redis record SHALL be gone

#### Scenario: Activity extends the session

- **WHEN** an authenticated request is served
- **THEN** the session's expiry SHALL be extended by the full idle window, up to but not beyond its absolute expiry

#### Scenario: Web session ends one shift's length after login

- **WHEN** a continuously active web session reaches 12 hours after it was issued
- **THEN** the API SHALL respond 401 on the following request, so that a session begun at the start of a shift does not outlive that shift

#### Scenario: Absolute expiry is measured from issuance, not the clock

- **WHEN** a web session is issued shortly before a shift changes over
- **THEN** it SHALL still receive the full 12-hour window rather than expiring at the shift boundary

#### Scenario: Bearer sessions have no absolute expiry

- **WHEN** a session issued to a bearer client remains in use beyond 12 hours
- **THEN** it SHALL remain valid until its idle window lapses, since off-shift use is its purpose

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

#### Scenario: NIK not matching an employee is accepted for now

- **WHEN** a row carries a NIK that matches no employee record
- **THEN** the row SHALL be accepted, because employee master data is provisioned by a later change

#### Scenario: Malformed file

- **WHEN** an uploaded file is not a readable spreadsheet, exceeds the size cap, or carries unrecognised columns
- **THEN** the API SHALL reject it with a validation error and SHALL NOT partially import it

#### Scenario: Unauthorized import

- **WHEN** a caller without `manage` on the `users` menu attempts a template download, validation, or commit
- **THEN** the API SHALL respond 403

### Requirement: Administrator-initiated password reset

An authorized caller SHALL be able to reset an account's password to the
configured default without knowing the previous one.

#### Scenario: Reset a password

- **WHEN** an authorized caller resets an account's password
- **THEN** the account's password SHALL become the configured default and the account SHALL be marked as requiring a password change

#### Scenario: Unauthorized reset

- **WHEN** a caller without `manage` on the `users` menu attempts a reset
- **THEN** the API SHALL respond 403

### Requirement: Provisioned accounts must set their own password before use

An account created by import or returned by a reset SHALL be able to
authenticate but SHALL be refused everywhere else until it sets a new password.

#### Scenario: First login with the default password

- **WHEN** an imported account logs in with the configured default password
- **THEN** the API SHALL issue a session and the session response SHALL report that a password change is required

#### Scenario: Blocked until changed

- **WHEN** an account requiring a password change requests any route other than logout, session, or change-password
- **THEN** the API SHALL respond 403 in a form the web shell can distinguish from an ordinary permission failure

#### Scenario: Change clears the requirement

- **WHEN** such an account sets a new password
- **THEN** the requirement SHALL be cleared and the account SHALL be admitted to the routes its role permits

#### Scenario: Reset re-arms the requirement

- **WHEN** an account that had already set its own password is reset by an administrator
- **THEN** the requirement SHALL apply again on its next login

### Requirement: Password policy

A password set by an account holder SHALL meet a configured minimum length and
SHALL NOT be the configured default. The minimum SHALL be configuration, not a
compiled-in constant.

#### Scenario: Password below the minimum

- **WHEN** an account submits a new password shorter than the configured minimum
- **THEN** the API SHALL respond 422 naming the minimum, and the password SHALL NOT change

#### Scenario: Password equal to the configured default

- **WHEN** an account required to change its password submits the configured default as its new password
- **THEN** the API SHALL respond 422 and the change-password requirement SHALL remain in force

#### Scenario: Acceptable password

- **WHEN** an account submits a new password meeting the minimum and differing from the default
- **THEN** the password SHALL be updated and the change-password requirement SHALL be cleared

#### Scenario: Bootstrap credentials are held to the policy

- **WHEN** the seed runs with a configured bootstrap password shorter than the minimum
- **THEN** the seed SHALL fail with a clear error rather than creating a superadmin weaker than the policy it enforces

### Requirement: Logout

A caller SHALL be able to end its own session immediately.

#### Scenario: Logout invalidates the session

- **WHEN** an authenticated caller invokes logout
- **THEN** the session record SHALL be deleted, the cookie cleared, and any subsequent request with that identifier SHALL respond 401

### Requirement: Current session endpoint

The API SHALL expose an endpoint returning the caller's principal, effective
permissions, and scope, for the web shell to render navigation from.

#### Scenario: Authenticated caller

- **WHEN** an authenticated user requests the session endpoint
- **THEN** the response SHALL include the account identity, role name, scope, and the effective menu-slug-to-mode map

#### Scenario: Unauthenticated caller

- **WHEN** no valid session is presented
- **THEN** the API SHALL respond 401

### Requirement: Account deactivation takes effect immediately

Deactivating an account SHALL invalidate its access on the next request rather
than at session expiry.

#### Scenario: Deactivated mid-session

- **WHEN** an account is deactivated while it holds a live session
- **THEN** its next request SHALL respond 401

### Requirement: Display devices are registrable principals

A display device SHALL be registered as a `devices` record with an identifier,
a name, a kind, and an active flag. A device SHALL NOT be represented as a user
account and SHALL carry no role, scope, or NIK.

#### Scenario: Register a device

- **WHEN** a caller with `manage` on the relevant display menu registers a device
- **THEN** the device SHALL be persisted as inactive-until-paired and returned with its identifier

#### Scenario: Device is not a user

- **WHEN** the accounts collection is listed
- **THEN** registered devices SHALL NOT appear in it

### Requirement: Device pairing is single-use and time-limited

A device SHALL be paired by opening a pairing link once. The pairing token MUST
be consumable exactly once and MUST expire.

#### Scenario: Successful pairing

- **WHEN** a valid, unused, unexpired pairing link is opened on a device
- **THEN** the API SHALL set a long-lived `universe_device` cookie, consume the token, and redirect to the device's display route

#### Scenario: Reused pairing link

- **WHEN** a pairing link that has already been consumed is opened again
- **THEN** the API SHALL respond 401 and SHALL NOT issue a device session

#### Scenario: Expired pairing link

- **WHEN** a pairing link is opened after its expiry window
- **THEN** the API SHALL respond 401 and SHALL NOT issue a device session

### Requirement: Device sessions are confined to display routes

A device session SHALL grant read-only access to display data and nothing else.

#### Scenario: Device reads display data

- **WHEN** a paired device requests the data for its display kind
- **THEN** the API SHALL respond 200

#### Scenario: Device rejected on the admin surface

- **WHEN** a device session is presented to any non-display endpoint
- **THEN** the API SHALL respond 403

#### Scenario: Device attempts a write

- **WHEN** a device session is presented on any mutating endpoint
- **THEN** the API SHALL respond 403

### Requirement: Device heartbeat drives online status

A paired device SHALL report activity, and the system SHALL derive its online
state and last-seen time from that record rather than from an assumption.

#### Scenario: Heartbeat recorded

- **WHEN** a paired device requests its display data
- **THEN** the device's `last_seen_at` SHALL be updated

#### Scenario: Online state derived

- **WHEN** the device registry is listed
- **THEN** each device SHALL report an online state and a last-seen value computed from `last_seen_at`

### Requirement: Device revocation

Deactivating a device SHALL invalidate its session on the next request.

#### Scenario: Deactivated device

- **WHEN** a device's `active` flag is set to false while it holds a live session
- **THEN** its next request SHALL respond 401 and it SHALL report as offline in the registry
