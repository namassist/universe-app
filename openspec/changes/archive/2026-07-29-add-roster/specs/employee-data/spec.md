## MODIFIED Requirements

### Requirement: An employee with a trace cannot be deleted

Deleting an employee that is still referenced SHALL be refused. The API SHALL
respond 409 and SHALL name what references it, and the employee SHALL remain.

An account whose NIK matches the employee SHALL count as a reference, even
though no database constraint enforces it.

Roster days and roster revision entries SHALL count as references, and these
SHALL be enforced by database constraints rather than by the route alone.

#### Scenario: Delete an employee who has an account

- **WHEN** a caller attempts to delete an employee whose NIK an account carries
- **THEN** the API SHALL respond 409, SHALL name the account as the reason, and the employee SHALL remain

#### Scenario: Delete an employee who has roster days

- **WHEN** a caller attempts to delete an employee that any roster document carries days for
- **THEN** the API SHALL respond 409, SHALL name the roster as the reason, and the employee SHALL remain

#### Scenario: Delete an employee who has revision entries

- **WHEN** a caller attempts to delete an employee named by any roster revision entry
- **THEN** the API SHALL respond 409, SHALL name the revisions as the reason, and the employee SHALL remain

#### Scenario: An archived roster still protects the employee

- **WHEN** a caller attempts to delete an employee whose only roster days belong to archived documents
- **THEN** the API SHALL respond 409 and the employee SHALL remain, because archived documents are history that must stay readable

#### Scenario: Delete an employee with no trace

- **WHEN** a caller holding `manage` on `employees` deletes an employee that nothing references
- **THEN** the employee SHALL be removed, together with its qualification code assignments

#### Scenario: Deletion never cascades to referencing records

- **WHEN** a deletion of a referenced employee is attempted
- **THEN** no referencing record SHALL be deleted, altered, or left with an unresolvable reference
