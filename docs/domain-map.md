# Domain map — allocation, displays, tickets

The short version of the three areas where a wrong guess costs a unit its
operator. It points into `docs/prd.md` (the requirement record, and the
tiebreaker) and into the code. Read the relevant section here before touching
any of these areas, then the PRD section it names. If this file and the PRD or
the code disagree, the code and PRD win. Fix this file in the same change.

## Glossary

| Term                             | Meaning                                                                                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Unit                             | A machine (dump truck, excavator, dozer…), `units`. Has `active`, `breakdown`, `standby`, `ftw` (requires FTW), an optional department and SIMPER code, its own `work_area` and transport. |
| Formation / fleet                | One **leader** unit (any type, usually a digger) plus 1–13 haulers (`fleets`, `fleet_units`). One work area per formation.                                                                 |
| Support unit                     | A unit in no formation but crewed (`units.fleet_support`, set by the Fleet Setting import). Grouped as **Support**.                                                                        |
| No fleet                         | Active units in no formation and not support. Derived and never stored. **Not allocated**, only listed so they don't go unnoticed.                                                         |
| PLAN                             | Standing unit ↔ operator pairs, max 2 per unit, no date, no shift (`fleet_plan_slots`).                                                                                                    |
| ACTUAL / board                   | One shift's generated allocation (`fleet_actual_slots`, `fleet_actual_fleets`), built by `spare-validate`.                                                                                 |
| Standing operator / holder       | An operator with a PLAN slot.                                                                                                                                                              |
| Spare                            | An allocatable operator with no seat today: no PLAN slot, or a slot on a unit outside allocation, broken down, or taken by the shift partner.                                              |
| Roster code                      | Per person per day (`roster_days`, active document only). `D` = day, `N` = night; anything else (`CR`, `OFF`, `A`, `TGS`…) means not working. `rosterShift()` in contracts.                |
| FTW                              | Fit To Work. Sleep-based verdict from savera, snapshotted into `ftw_readings`.                                                                                                             |
| Finger / tap                     | Fingerprint attendance, snapshotted into `finger_readings` (derived from `device_taps` by `derive.ts`).                                                                                    |
| SIMPER                           | Operator's permit. Its codes are the skill key; a unit with a SIMPER code only takes an operator holding it, unexpired.                                                                    |
| `aktif` / `standby` / `nonaktif` | Employee status. **Only `aktif` is ever allocated or printed a seat.** `standby` may be _planned_, never seated.                                                                           |
| Muster                           | One shift's run of the timeline gates.                                                                                                                                                     |
| Wall                             | A paired TV page under `/display/*`.                                                                                                                                                       |
| Slip / ticket                    | ESC/POS paper printed at a Universe booth after a tap.                                                                                                                                     |

## The timeline drives everything

Stages are **data** (`timeline_stages`, edited on the Timeline menu), one row
per action × shift. Never hardcode a gate time. Read it (`stage-time.ts`,
`readiness.ts`). Seeded schedule (`db/seed-master.ts`), night = +12 h:

| Time  | Action           | What happens                                                        |
| ----- | ---------------- | ------------------------------------------------------------------- |
| 04:00 | `shift-start`    | Walls turn over to this shift; tap collection arms                  |
| 04:00 | `ftw-ingest`     | FTW pull begins, re-pulls every minute until `ftw-deadline`         |
| 04:30 | `finger-ingest`  | Live listening opens on "Universe only" booths                      |
| 05:22 | `ftw-deadline`   | An upload at/after this is `late` (does not pass)                   |
| 05:25 | `finger-in`      | A first IN tap at/after this is `late`                              |
| 05:26 | `spare-validate` | **The board is built** (one minute after `finger-in`, never on it)  |
| 05:28 | `finger-second`  | No hook. A spare's slip is held until this time (`ticket-issue.ts`) |
| 05:30 | `bus-depart`     | Listening/collection windows end (plus grace)                       |

- **Missing gate = refuse, never default.** No `finger-in` or `ftw-deadline`
  stage means `spare-validate` builds no board and notifies
  (`no-finger-deadline`). The fleet wall stays on the provisional line-up and
  drops its readiness badges. Tickets need `finger-in`, `ftw-deadline` and
  `finger-second`; without any of them nothing prints (`issueTicket` returns
  `no-deadline`), though the tap is still recorded. Only a missing
  `shift-start`/`ftw-ingest` pair makes a wall say the timeline cannot decide.
- A stage's time may only change **before** the running muster passes it
  (`timeline-edit.ts`, `editRefused`). Reset re-arms listen/collect windows
  and **never** re-runs `spare-validate`.
- Hooks: `scheduler.ts` (`HOOKS`). Sound cues 2 min before a stage:
  `sound-cue.ts`.
- PRD: _Readiness on both shifts_, _Re-arming a muster_, _The timeline's sounds_.

## Allocation

**Goal:** every unit in scope has a ready, eligible operator at shift start.
Gaps are filled from the spare pool.

### Readiness: may this person take a unit on this shift?

`readiness.ts`, `judge()` (pure, never reads the clock):

- **FTW passes** only when decision = `FTW aman` **and** category =
  `Dapat Bekerja`, uploaded **before** `ftw-deadline`. A missing row fails.
  A late upload is `late`, not `fail`. An unrecognised wording is
  `unreadable`, never a quiet fail.
- **Finger passes** when the first IN of **that shift** is strictly before
  `finger-in`. Resolve the IN with `shiftIn(reading, shift)`, never
  `firstInAt ?? firstInPmAt`. The IN is split at 12:00. An OUT-only row is
  `missing`.
- A unit with `ftw = false` judges the tap alone.
- The category is computed **by Universe from savera's own rules**. savera's
  word is kept in `ftw_readings.savera_category` and not shown.
- External sources (savera, booths) are read-only and **never queried from a
  request path**. Only the ingest stages read them.

### Eligibility: may this person take _this_ unit?

`pairingRefusal()` in `routes/fleet-allocation.ts` (pure; `refusePairing` is
its fetching wrapper). PLAN, the engine, plan seats on slips and the manual
placement candidates all call it. **One exception:** `cannotBeSeated` in
`ticket-issue.ts` restates part of eligibility in SQL (SIMPER held, `ftw =
false`, seatable), so a new eligibility rule must be added there too. The
rule checks:

- the employee is `aktif` (PLAN alone also admits `standby`, via the `planning` flag)
- their position has `fleetAllocation`
- they hold the unit's SIMPER code, unexpired
- a department-owned unit takes only that department

"One unit per operator" is not in `pairingRefusal`. It is enforced by the
engine's `taken` set, the PLAN routes, and a partial unique index on the board
(a 409 naming the unit).

### Scope: which units the board is about

**Active, not breakdown, and (in a formation or `fleet_support`)**. The
formation/support half is `takesPartInAllocation()` in `fleet-scope.ts`; each
caller adds `active` and `breakdown` itself, so check both halves when writing
a new query. Standby units **are** allocated (since
2026-09-15). The web mirror is `inAllocation` / `vacantOn` in
`components/menus/fleet-allocation/data.ts`. Keep both in step.

### The engine: `buildBoard()` in `allocation.ts`

1. Rows come from **`units`**, not from PLAN, so an unpaired unit still shows as a vacancy.
2. For each unit, among its standing holders rostered to the shift, the holder
   is chosen by: ready + eligible → already holds a slip naming the unit →
   earlier tap → NIK. If that holder passes, they keep the unit (`source: plan`).
3. The spare pool (rostered `aktif` allocatable operators not seated, finger
   passed) is sorted **unattached first, then standing-elsewhere** (ordering,
   never filtering), then by tap, then NIK.
4. Vacancies are sorted by **Prioritas Alokasi rank**, then by the database's
   `asc(code)` index. The rank is stored per `units.description` (matched
   exactly, as spelled; `allocation_priorities`), the text the PRD describes as
   a (unit class, SIMPER code) pair. Unranked descriptions sort last.
5. Spares already holding a slip for a vacancy keep it. Then each vacancy takes
   the first spare that is ready for that unit and eligible (`source: spare`).

Invariants:

- **Deterministic.** The same inputs give the same board.
- `storeBoard` **replaces** the shift's board. This loses manual placements, so
  never trigger a regenerate implicitly.
- A board **copies** its formations (leader code, area, bus) into
  `fleet_actual_fleets`. Walls and history read the copy, never today's Fleet
  Setting.
- Manual placement (Actual tab) is `source: manual`, logged in
  `fleet_placements`. Placing over a failed or missing FTW requires explicit
  confirmation.
- Failures notify with a reason from a **closed list** (never the error text).

Code: `allocation.ts`, `readiness.ts`, `fleet-scope.ts`, `routes/fleet-allocation.ts`
(PLAN), `routes/fleet-actual.ts` (boards, audit, candidates, manual edit),
`routes/allocation-priority.ts`, `routes/fleets*.ts` and
`routes/fleet-allocation-import.ts` (Fleet Setting / imports).
Web: `components/menus/fleet-allocation/*`, `fleet-allocation.tsx`,
`allocation-priority.tsx`, `fleet-setting*.tsx`.
Tests: `allocation.test.ts`, `readiness.test.ts`, `routes/fleet-allocation*.test.ts`,
`routes/fleet-actual.test.ts`, `routes/allocation-priority.test.ts`, `crew-rows.test.ts`.
PRD: _Asset & Fleet_, from _Fleet composition_ through _The Actual tab_.

## Displays (walls)

Paired TVs are a principal of their own: device cookie, read-only, `/display/*`
only, no role, no scope. A signed-in person may also view a wall (needs the
menu's `view`) and is **never** scoped to formations. Every kiosk route opts in
with `allowDevice`. The proxy check is UX, not security.

`GET /v1/display/:kind` (`routes/devices.ts`) is the heartbeat poll. It also
carries the running text and the **next sound cue**, and the server decides
when the sound plays.

| Wall                                                   | Web page                  | API                                                                             |
| ------------------------------------------------------ | ------------------------- | ------------------------------------------------------------------------------- |
| Fleet (per formation, plus built-in Support and Spare) | `app/display/fleet`       | `GET /v1/fleet-allocation/actual/display` (`routes/fleet-actual.ts`)            |
| Fit to work                                            | `app/display/fitwork`     | `GET /v1/fit-to-work/display` (`routes/readiness-display.ts`)                   |
| Attendance (the latest scan, as a ticket)              | `app/display/attendance`  | `GET /v1/attendance/display/scans` (`routes/attendance-scans.ts`)               |
| Fingerprint machines                                   | `app/display/fingerprint` | `GET /v1/fingerprint-machines/display`, reading stored probe rows (`prober.ts`) |

Fleet wall rules:

- **No date or shift picker.** The shift is read from the clock against the
  timeline (`current-shift.ts`). A night board is filed under the date it began.
- From `shift-start` until `spare-validate` it shows the **provisional PLAN**
  read through the roster (`D`/`N`), badged "Line-up sementara". After that it
  shows the board. Before the board, an empty card has no red frame or glow
  (the small "Kosong" seat chip still uses the danger tone).
- No-fleet units never reach a TV. Breakdown units are absent. Idle units keep
  a full red card and are **never** summarised away. Header counts are the
  formation's own, never the site's.
- Readiness badges: before a gate shuts, a missing reading is grey ("Belum…").
  After it shuts, red ("Tidak…"). Only screens ask the clock; `judge` does not.
- Every rostered operator appears on **exactly one** wall: a formation, Support,
  or Spare.
- Per-device config: `device_fleets` (no rows means every fleet; pick order is
  the screen order), `rotate_seconds`, `layout` (`slideshow | monitor-2 |
monitor-4`), `card_layout` (`overlay | identity`), `sound`. Built-in
  `fleet-support` and `fleet-spare` cannot be deleted. Only their dwell, card
  layout and sound are editable.
- An endpoint never errors on an empty answer. It states "no board yet" or
  "timeline cannot decide", because a blank TV sends someone to check hardware.

Code: `routes/fleet-actual.ts`, `routes/readiness-display.ts`,
`routes/attendance-scans.ts`, `routes/devices.ts`, `current-shift.ts`,
`sound-cue.ts`. Web: `app/display/**`, `lib/queries/{fleet-display,readiness-display,display}.ts`.
Tests: `routes/readiness-display.test.ts`, `routes/display-cue.test.ts`,
`routes/devices.test.ts`, `sound-cue.test.ts`, `scan-queue.test.ts`.
PRD: _The support wall_ through _A fleet wall chooses its card layout_,
_Kiosk access_, _The attendance wall shows the scan as a ticket_.

## Tickets (muster slips)

A tap at a **"Universe only"** booth (live listen, `live-listener.ts`) prints a
slip on the booth's one paired printer (ESC/POS, port 9100). Production
machines are never listened to, because listening sends `enableDevice`.

- **Everyone who taps gets a slip** as proof of attendance. The one exception:
  a **spare at the first finger** is recorded and printed at `finger-second`.
- Unit, bus, fleet and area are printed **together or not at all**. A person
  with no seat reads `UNIT: SPARE` (an `aktif` allocatable operator) or `-`
  (everyone else).
- **Source of the seat:** before the board, the **PLAN**, judged at the booth
  with the board's own rules and tie-break. After the board, **only the
  board** (engine or manual), printed as-is and never re-judged.
- Spares print at once when they can never be seated (late first tap, or an
  FTW that is a final no on every unit they could take).
- The printed time is always the **first tap of the shift**.
- A repeat tap reprints **only if the slip's content changed**. Arrival time
  and booth don't count, because machine clocks disagree.
- A printer failure is retried ~60 s, then queued for manual reprint. Nothing
  prints unattended later.
- **No late tolerance.** A late person reaches a unit only through a manual
  placement, then taps again.
- Machine clocks are **local wall time**. `parseHexToTime` builds local
  components, and reading them as UTC was a real bug. Test with real-clock
  fixtures, not with the code's own construction.

Code: `ticket-rules.ts` (`ticketFor`, pure; one test per row of the PRD table),
`ticket-issue.ts` (`issueTicket`, `seatOf`, `planSeatHolds`, `cannotBeSeated`,
`reprintTicket`), `ticket-escpos.ts`, `ticket-printer.ts`, `spare-ride.ts`,
`live-listener.ts`, `derive.ts`, `routes/tickets.ts`, `routes/printers.ts`.
Web: `components/menus/tickets.tsx`, `printers.tsx`, `monitoring-tap.tsx`.
Tests: `ticket-rules.test.ts`, `ticket-issue.test.ts`, `ticket-escpos.test.ts`,
`live-listener.test.ts`, `routes/tickets.test.ts`.
PRD: _Live capture and muster tickets_ (all subsections).

## Keeping this file true

When a change moves a gate, a rule, an endpoint, or a file named here, update
this file in the same commit. Stale guidance here is worse than none, because an
agent will trust it.
