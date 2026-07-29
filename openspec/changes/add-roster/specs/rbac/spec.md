## ADDED Requirements

### Requirement: The subject of a scoped write is determined by the server

Where a request creates or changes a record that belongs to a particular
employee, the employee it belongs to SHALL be determined by the server from the
caller's scope and session, not accepted as an identity field in the request
body.

For a `self`-scoped caller the subject SHALL be resolved from the caller's own
NIK, and any employee named in the request SHALL have no effect. For callers of
wider scope the subject MAY be named in the request, and SHALL be validated
against the caller's scope predicate before anything is written.

This SHALL hold regardless of what the client renders, because a hidden or
disabled control is not the boundary.

#### Scenario: Self scope writes only for itself

- **WHEN** a `self`-scoped caller creates a record naming an employee other than itself
- **THEN** the record SHALL be created against the caller's own employee record, and the named value SHALL have no effect

#### Scenario: A wider scope is still bounded

- **WHEN** a `dept`-scoped caller creates a record naming an employee of another department
- **THEN** the API SHALL respond 403 or 404 and SHALL NOT create the record

#### Scenario: The identity field is never trusted

- **WHEN** a request carries an employee identity field that contradicts the caller's scope
- **THEN** the server SHALL decide from the session and the scope predicate, and SHALL NOT be influenced by the request value

#### Scenario: Hiding the control is not the boundary

- **WHEN** a client omits the subject selector for a `self`-scoped caller
- **THEN** the API SHALL enforce the same restriction independently of that omission
