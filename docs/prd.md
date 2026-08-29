# Product requirements — durable record

OpenSpec (`openspec/specs/`) is frozen as the historical requirement archive.
Requirements agreed after that freeze accumulate here, per feature area, and
each change keeps this file and the per-app `docs/` up to date.

## Asset & Fleet

**Goal:** allocate every unit an operator at the start of each shift — zero
avoidable unit downtime.

**Pain point:** units standing idle at shift start because their operator is
off, on leave, or failed fitness/attendance checks, with no systematic way to
fill the gap from the spare pool.

### Fleet composition (Fleet Settings) — shipped

- A fleet is one **digger** (leader), 1–13 **member units** (haulers/support),
  a **Mining work area**, and optionally a **crew bus** (a unit of type BUS).
  Bounds live in `@universe/contracts` (`FLEET_MIN_UNITS`/`FLEET_MAX_UNITS`).
- A digger leads at most one fleet; a unit hauls for at most one fleet; a
  fleet leader never hauls for another fleet. All held by unique indexes, with
  route prechecks that name the offending unit in the refusal.
- "Digger-ness" (type EXCAVATOR / digger classes) is a UI heuristic, not an
  API rule — the catalogues carry no fleet-leader flag.
- Deleting a fleet releases its members; the units themselves are untouched.

### Unit status — shipped

- A unit's status is **derived**: `breakdown` > `standby` > `ready`, from the
  two existing boolean columns. A transition rewrites both flags every time,
  so past changes cannot compound into a unit both broken and standing by.
- Changing status requires a reason; every change appends to a per-unit
  history timeline (`unit_status_history`), written in the same transaction
  as the flags. The list reports only active units.
- A unit's displayed location is its fleet's work area — whether it leads the
  fleet or hauls in it; a unit in no fleet shows none.

### Fleet allocation — Plan tab shipped, Actual deferred

- **Plan** holds the standing unit ↔ operator pairs (`fleet_plan_slots`): at
  most 2 operators per unit, one Day and one Night. On the assignment date,
  two operators whose roster codes resolve to the same shift kind are
  refused; an operator with no roster row is allowed and flagged
  (`sameShift` in the candidate list). The board arrives composed from
  `GET /v1/fleet-allocation/plan` — units with status/location/fleet embeds
  and resolved pairs, the fleet filter options, and the spare pool.
- **Candidate eligibility:** position carries `fleetAllocation`; if the unit
  requires a SIMPER code, the operator holds it (`employee_skills`) and their
  SIMPER is not expired; a unit owned by a department only accepts operators
  of that department (a unit with no department is global); an operator pairs
  with at most one unit.
- **Spare pool** = fleet-allocation-position operators with no assigned unit.
  Spares follow their own roster and cannot be called outside their shift.

### FTW + attendance ingestion — shipped

- Both readiness signals are **snapshotted into local tables** (`ftw_readings`,
  `finger_readings`, keyed `nik` × `date`) — external sources are read-only
  and never queried from a request path; historical questions are answered
  locally.
- **FTW** comes from savera's `saverawatch` DB (`summary_insights_v2` +
  joins), manual uploads only, filtered to this site's company. The verdict
  is ingested as text (sleep minutes, sleep category, FTW decision) — savera's
  rules are operator-configurable, so re-encoding them here would drift.
- **Attendance** comes from Nakula's raw tap log (`tbl_absen_all`), reduced to
  first IN / first OUT per person per day with device IPs — deliberately not
  Nakula's interpreted view (30 s a query vs milliseconds). Raw as recorded;
  shift-aware interpretation belongs to the consumer.
- **Timeline-driven, deadline-final:** the `ftw-ingest` (04:45) and
  `finger-ingest` (05:15) stages fire once and re-pull each minute for a
  bounded window (`INGEST_WINDOW_MINUTES`, default 5) — retry and
  late-arrival tolerance in one, everything settled before the 05:30 bus.
  A post-deadline upload does not count: the snapshot is final by rule, not
  stale. Manual sync routes (manage mode) cover pulls outside the timeline
  and recovery.
- NIKs normalize digits-only / no leading zeros (savera's production-proven
  recipe) — the cross-system join key.

### Readiness on both shifts — shipped

- **FTW and fingerprint are required morning and night** (owner, 2026-08-29).
  The timeline is no longer the morning's alone: the day's six stages have a
  mirror twelve hours later (16:45 FTW, 17:15 finger, 17:25 spare validation,
  17:30 bus). Without an afternoon ingest a night worker's 15:00 FTW upload and
  17:00 tap are not pulled until the _next_ morning's run — about fourteen
  hours after a night board would need them.
- **The shift lives on the stage, not in the action.** `timeline_stages.shift`
  (`day | night`, nullable) is what tells two rows carrying the same action
  apart. A night-suffixed action per stage would have grown the vocabulary once
  per action and left "day" as the unmarked default, which it is not.
- Nothing in the scheduler changed. Stages are claimed per row
  (`stage:${id}:${date}`), so a second row with the same action fires on its
  own, and both ingest hooks are idempotent upserts. `Dispatch` now carries
  `shift` so a hook doing real work knows which half of the day fired it.
- **`ftw_readings.shift` is not the shift and must never be read as one.**
  savera defines a `Shift 2` and no row has ever carried it: every upload is
  labelled `Shift 1` whatever the hour. The signal that night workers do fill
  FTW is the upload _time_ — savera's uploads peak twice, 03:00–05:00 and
  13:00–17:00. Shift comes from our own roster (`roster_days` +
  `rosterShift()`), the same authority the PLAN board uses.

### The pass rule — shipped

- **May this person take a unit on this shift?** One named, tested function
  (`readiness.ts`), not a `where` clause inlined at the single place that
  needs it today. FTW passes when the decision is `FTW aman` **and** the sleep
  category is `Dapat Bekerja`; the fingerprint passes when the first IN tap is
  **strictly before** that shift's `finger-in` deadline, read from the master
  timeline. Both for a unit whose `ftw` flag is set, the tap alone otherwise.
- **The two FTW verdicts are separate axes and they disagree.** In seven days,
  234 readings say `FTW aman` beside a sleep category forbidding work — 105 of
  them `Tidak Boleh Bekerja`. Reading the decision alone is the obvious
  implementation and puts all 234 on a machine. `Istirahat Minimal 1/2 Jam` is
  a failure, not a conditional pass: the rule does not model "may work after
  resting" (owner, 2026-08-29).
- **A missing FTW row is a failure, not an exemption**, and a late upload never
  counts — the ingest window's "final by rule, not by staleness", carried
  through.
- **A verdict savera has reworded reads as `unreadable`, never as a quiet
  failure.** The readings are text precisely because savera's rules are
  operator-configurable; the cost is that a rewording stops matching, and this
  is where that cost becomes visible instead of emptying a board with no clue.
  All four verdict values observed in live data are known; comparison ignores
  casing and padding.
- **A row carrying only an OUT tap is `missing`, not `late`** — 1,466 of 8,906
  rows. It says nothing about arrival rather than denying it.
- **No deadline in code.** `fingerInDeadline(shift)` returns null when the
  stage is missing or switched off, and a caller must refuse to build a board
  rather than invent one: an early default fails everyone, a late one passes
  everyone, and neither is visible.
- Checked against every live row, not only fixtures: the rule and the
  equivalent SQL agree exactly — FTW 3,406 pass / 378 fail of 3,784, and
  fingerprint 5,053 pass / 2,387 late / 1,466 missing of 8,906.

### The allocation engine — shipped

- `spare-validate` is no longer a no-op. It builds and stores one shift's
  board: every unit holding a PLAN slot (minus `breakdown` and `standby`, which
  need no operator), its planned operator kept if they pass, and every vacancy
  offered to the spare pool **first come first served by `first_in_at`**,
  subject to the same SIMPER and department rules PLAN enforces.
- **The eligibility rules stayed one implementation.** `refusePairing` ran a
  SIMPER query per call, which the engine would have asked thousands of times
  in the one code path that runs against a clock. The rule was extracted as a
  pure predicate over preloaded data (`pairingRefusal`) with `refusePairing` as
  its fetching wrapper — rather than a second bulk copy, whose drift would show
  up as an operator who may be paired by hand but never by the engine.
- **Two refusals rather than a board built on a guess:** a stage carrying no
  shift cannot say which board it is building, and a shift with no active
  `finger-in` stage has no deadline and therefore no pass rule. Both log and
  stop. A full screen of confident nonsense is worse than an empty one.
- **Placement is deterministic** — `tapped_at` then NIK — so a regenerated
  board is identical to the one people already read.
- **The plan is standing, so it has no date**: every unit in `fleet_plan_slots`
  appears on every board. Correct for the yard, and the thing that makes shared
  fixtures in tests lie.
- **Not yet verified end to end.** Dev holds no PLAN slots and no roster for a
  date the readings cover, so a live run produces an empty board without error.
  An August roster and PLAN data are the prerequisite for acceptance testing.

### Deferred until the Actual-tab engine exists

- **Actual tab:** generated per shift by Manpower — assigned operators who
  pass FTW/attendance keep their unit; vacancies fill from the spare pool
  **FCFS by the moment they pass** FTW + fingerprint, subject to the same
  SIMPER and department rules. Consumes `ftw_readings` + `finger_readings`;
  needs no new external queries. Some units require FTW + fingerprint; others
  fingerprint only (`units.ftw` flag).
- The scheduler's `spare-validate` hook (05:25) stays no-op until this engine
  lands.

## Kiosk access

**A kiosk admits two kinds of viewer, because it has two.** A wall-mounted TV
logs in as nobody: it carries the device cookie a pairing link minted, and that
is all it will ever have. A person checking the same wall from their desk
carries a session instead.

- `/display/*` is served to **either** credential; a request with neither is
  redirected to the login page carrying `?next=`, exactly like any other route.
  Admitting only the device cookie made every human visit a redirect to a login
  page that could not help — signing in produced a session, and a session was
  what the check refused.
- The presence check in `apps/web/proxy.ts` is user experience, not the
  boundary. Every kiosk endpoint re-decides independently: a person still needs
  the menu's `view` grant, and a device is still refused on any write and on any
  route not marked `allowDevice`.
- **The user session is resolved before the device session.** Signing a
  _low-privileged_ account into a paired TV's own browser therefore darkens that
  screen — the session wins, fails the grant check, and the device cookie beside
  it is never consulted. Pair TVs, and leave them logged out.

## Fingerprint monitoring

**Goal:** an outage on any of the ~58 fingerprint machines is visible within
about a minute, on a TV, without asking another team.

**Pain point:** when a machine dies, nobody knows until workers pile up at a
gate unable to tap. Nakula's tables cannot answer the question honestly —
`tbl_finger_last_seen` records the last _tap_ (activity, not reachability) and
`tbl_finger_log_error` logs only ping failures, from an external agent that
runs intermittently.

### Machine registry (Mesin Fingerprint) — shipped

- The registry is **owned by universe-app**, not read from Nakula: menu
  `mesin-fingerprint` in the Master group with full CRUD over name, IP, and an
  active flag, seeded with the 58 machines in use across three subnets
  (179.x at KM 31, 150.x workshops/port/mess, 109.x FAS/TF).
- **The IP is the machine's identity** and is unique — it is what a probe will
  dial, so two rows on one address would be probed twice and reported as two
  machines. A duplicate is a 409, a malformed address a 422. Validation runs
  after trimming, so an address pasted from a spreadsheet is accepted.
- Deactivating beats deleting for a machine that is merely unplugged: the row
  keeps its identity and drops out of probing and off the wall.
- The page carries the registry and nothing else. A pairing panel was built
  here and then removed at the owner's request — kiosk access is a person's
  session now, not a second device to administer (see _Kiosk access_ above).

### Reachability probing — shipped

- Machines are ZKTeco-compatible (Solution X100-C) and answer **TCP on port
  4370**. A connect-and-close probe is the reachability signal; no ZK
  handshake, so the probe cannot contend with whatever collects taps into
  Nakula. Ping is the wrong test — at least one machine blocks ICMP while
  accepting 4370.
- A background loop (not a timeline stage — monitoring is continuous, not
  deadline-driven) probes every active machine every **30 s** and records
  `online`, `last_seen_at`, `checked_at`, `status_since`. A machine flips
  offline only after two consecutive misses, so one dropped packet does not
  flash red on a wall-mounted TV. The kiosk polls on the same 30 s cadence, so
  an outage reaches the wall in about a minute and a half at worst.
- The kiosk reads those stored rows; the request path opens no sockets, the
  same principle as never querying an external source from a request path.
- **Probes are pooled, not fired all at once.** Measured on site: the slower
  machines answer a lone connect in ~1.2 s, but fifty-eight simultaneous
  connects pushed them past a 3 s timeout and reported four reachable machines
  as offline. `PROBE_CONCURRENCY` (10) and a 5 s timeout removed the false
  alarms; a full cycle takes ~3.4 s, far inside its interval. A monitoring wall
  that cries wolf is worse than one that answers a second later.
