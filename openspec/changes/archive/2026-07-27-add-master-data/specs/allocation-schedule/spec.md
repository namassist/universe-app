## ADDED Requirements

### Requirement: Timeline stages are persisted, editable records

The system SHALL persist the morning allocation schedule as timeline stage
records, each carrying a name, a time of day, an action, and an active flag.

Stages SHALL be creatable, editable, and deletable at runtime by a caller
holding `manage` on the `timeline` menu. Changing the schedule SHALL NOT require
a code change or a deployment.

#### Scenario: Create a stage

- **WHEN** a caller holding `manage` on `timeline` creates a stage with a name, a time, and an action
- **THEN** the stage SHALL be persisted and SHALL appear in subsequent list responses

#### Scenario: Change a stage's time

- **WHEN** a caller changes a stage's time
- **THEN** the change SHALL be persisted and SHALL govern when that stage next fires

#### Scenario: Add a stage beyond the established five

- **WHEN** a caller creates a sixth stage
- **THEN** it SHALL be persisted and treated identically to the seeded stages

#### Scenario: Write with only view grant

- **WHEN** a caller holding only `view` on `timeline` attempts to create a stage
- **THEN** the API SHALL respond 403

### Requirement: The stage action vocabulary is defined in the shared contracts

The set of permitted timeline actions SHALL be defined once in the shared
contracts and SHALL be the source of the database enum, the API schema, and the
client's labels, so the three cannot drift.

The vocabulary SHALL include the Fit To Work upload deadline, the fingerprint
check-in deadline, fingerprint ingestion, spare validation, bus departure, and a
generic marker.

#### Scenario: Valid action accepted

- **WHEN** a caller creates a stage whose action is one of the defined values
- **THEN** the stage SHALL be persisted with that action

#### Scenario: Unknown action rejected

- **WHEN** a caller creates a stage whose action is not one of the defined values
- **THEN** the API SHALL respond 422 and SHALL NOT create the stage

#### Scenario: Actions are matched by value, not by label

- **WHEN** a stage's displayed label is changed in the client
- **THEN** the stage SHALL continue to fire the same action, because dispatch is by the contract value rather than by the label

### Requirement: Active stages fire at their configured time

The system SHALL fire each active stage when its configured time of day is
reached. An inactive stage SHALL NOT fire.

A stage SHALL fire at most once per day. Firing SHALL be recorded so the outcome
is observable without a user interface.

#### Scenario: A stage fires at its time

- **WHEN** the configured time of an active stage is reached
- **THEN** its action SHALL be dispatched exactly once and the firing SHALL be recorded

#### Scenario: An inactive stage does not fire

- **WHEN** the configured time of an inactive stage is reached
- **THEN** no action SHALL be dispatched for it

#### Scenario: A stage does not fire twice in one day

- **WHEN** a stage has already fired today
- **THEN** it SHALL NOT fire again that day, including after an API process restart within the same minute

#### Scenario: A time changed to a moment already passed

- **WHEN** a stage's time is changed to a time earlier than the current time on a day it has not yet fired
- **THEN** the behaviour SHALL be deterministic and recorded, and SHALL NOT cause repeated dispatch

### Requirement: Exactly one process fires a stage

When more than one API process is running, a stage SHALL be dispatched by
exactly one of them.

#### Scenario: Two processes, one dispatch

- **WHEN** two API processes are running against the same schedule and a stage's time is reached
- **THEN** the action SHALL be dispatched exactly once across both processes

#### Scenario: A process that loses the guard does not dispatch

- **WHEN** a process finds that another has already claimed a stage's firing
- **THEN** it SHALL NOT dispatch that stage and SHALL NOT report an error

### Requirement: Stage actions dispatch to a documented extension point

Each action SHALL resolve to a handler. Actions whose work is not yet
implemented — fingerprint ingestion and spare validation — SHALL resolve to
handlers that record the firing and perform no other work.

Adding the implementation for such an action SHALL NOT require changing the
scheduler, the locking, or the action vocabulary.

#### Scenario: An unimplemented action fires

- **WHEN** the spare-validation stage fires
- **THEN** the firing SHALL be recorded, no error SHALL be raised, and no other work SHALL be performed

#### Scenario: A marker action fires

- **WHEN** a stage whose action is a marker fires
- **THEN** the firing SHALL be recorded and no other work SHALL be performed

#### Scenario: Implementing an action later

- **WHEN** the work behind an action is implemented
- **THEN** it SHALL be attachable at the handler for that action, with no change to how stages are scheduled or guarded
