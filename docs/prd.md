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

- A fleet is one **leader unit** and 1–13 **member units**.
  Bounds live in `@universe/contracts` (`FLEET_MIN_UNITS`/`FLEET_MAX_UNITS`).
- **Any unit may lead** (owner, 2026-09-04). It is usually an excavator, and
  the screen used to offer only those from a private class heuristic; the yard
  runs formations led by a road unit and by a dump truck, and the API never
  enforced the heuristic anyway. The column says `leader_unit_id`.
- **Location and transport are facts about a unit, not about a fleet** (owner,
  2026-09-04). Every unit in today's operation carries its own `work_area` and
  its own transport, because a dozer, a water truck or a spare digger has both
  while belonging to no formation.
- **One formation cannot span two areas.** A fleet's area is its leader's, and
  writing a formation writes that value to every member — the rule is enforced
  on write rather than by storing an area on the fleet as well. Support units
  are not one formation, so they may each work somewhere different.
- **Transport is per unit and changes daily.** Two units of one formation may
  legitimately ride different vehicles. The dialog edits one value for a whole
  formation; when its units already differ it opens on "leave as they are" and
  submits no transport at all, so an edit about something else cannot flatten
  them. Type is route-enforced: BUS or MANHAUL TRUCK.
- The work location is **free text**, not a catalogue (owner, 2026-09-03).
  Pits open and close within days, so a master list of them would grow without
  bound and be mostly dead rows. Two consequences are accepted knowingly:
  nothing keeps the spelling uniform, and nothing records where a unit worked
  yesterday — the column holds today's answer. What a _board_ showed is kept,
  because a board copies it (see the Actual tab).
- A unit leads at most one fleet; a unit hauls for at most one fleet; a fleet
  leader never hauls for another fleet. All held by unique indexes, with route
  prechecks that name the offending unit in the refusal.
- Deleting a fleet releases its members; the units themselves are untouched.

### Fleet setting import — shipped

- **One row per unit**: `unit | area | fleet | bus` (owner, 2026-09-04). The
  file is the whole yard for one day — 318 machines in the first real one.
  The previous shape was one fleet per row with its members in a comma list,
  and it could not say that a location and a ride belong to a unit, nor that a
  unit can work without a formation.
- A row's role comes from the `fleet` cell alone: filled means it hauls for
  that formation; blank means it **leads** the formation named after it when
  some other row named it; blank and unnamed means a **support unit**.
- `area` doubles as the status marker: BREAKDOWN (either spelling) records the
  unit as broken down. The word is not kept as a location, because it is not
  one, and a broken unit is not put in a formation.
- Vehicle codes are matched with spaces and dashes removed — the same bus is
  written "UDBU 09", "UDBU09" and "UD-BU09" by three different people, and
  master holds `UD-BU09`. A genuinely unknown vehicle is still refused, by name
  and by row.
- **The file takes things away, and says so first** (owner, 2026-09-04). A
  formation it never names is disbanded; a unit it never names drops out of
  today's operation. Both lists are shown in the preview before the commit, so
  a wrong file is visible rather than only its consequences.
- Refused by row, with the row named: a unit listed twice, a leader with no row
  of its own, a unit that both leads and hauls, and members of one formation
  that disagree about their area.
- **Released means cleared, not merely unflagged.** A unit the file does not
  name loses its support flag, its work area and its transport together — a
  machine nobody named today is not working anywhere, and a leftover area had
  the Unit Status screen naming a pit the unit had been pulled out of.
- The sweep is **wider than allocation scope**: it reaches any active unit
  still carrying a work area, which is what a formation disbanded by hand
  leaves behind. Disbanding also clears its own units now, so the two paths
  agree; the sweep is what catches everything already stranded.

### Unit status — shipped

- A unit's status is **derived**: `breakdown` > `standby` > `ready`, from the
  two existing boolean columns. A transition rewrites both flags every time,
  so past changes cannot compound into a unit both broken and standing by.
- Changing status requires a reason; every change appends to a per-unit
  history timeline (`unit_status_history`), written in the same transaction
  as the flags. The list reports only active units.
- A unit's displayed location is **its own** `work_area`. Members of a
  formation all carry their leader's, so the reading is unchanged for them —
  what changed is that a unit outside every formation now has one too.

### Fleet allocation — Plan tab shipped, Actual deferred

- **Plan** holds the standing unit ↔ operator pairs (`fleet_plan_slots`): at
  most 2 operators per unit, one Day and one Night. On the assignment date,
  two operators whose roster codes resolve to the same shift kind are
  refused; an operator with no roster row is allowed and flagged
  (`sameShift` in the candidate list). The board arrives composed from
  `GET /v1/fleet-allocation/plan` — units with status/location/fleet embeds
  and resolved pairs, the fleet filter options, and the spare pool.
- **Candidate eligibility:** employment status is `aktif`; position carries
  `fleetAllocation`; if the unit requires a SIMPER code, the operator holds it
  (`employee_skills`) and their SIMPER is not expired; a unit owned by a
  department only accepts operators of that department (a unit with no
  department is global); an operator pairs with at most one unit.
- **Only `aktif` is allocatable** (owner, 2026-09-03). `EMPLOYEE_STATUSES` is
  `aktif | standby | nonaktif`; `standby` is on the payroll but not to be given
  a unit — light duty, a lapsed permit, an investigation. Every gate spells the
  rule out positively (`status = 'aktif'`) rather than excluding `nonaktif`, so
  a status added later is excluded by default, which is the safe direction for
  this list to fail in. The gate runs _before_ readiness: such a person is
  never judged, so their unit reports an empty seat with no verdict rather than
  a late or missing one.
- A rostered shift for anyone not `aktif` is a data mismatch, not an allocation
  outcome. The roster import warns on it by row; the roster itself is left
  alone, because the fix belongs on the Karyawan screen. Note the walls do not
  filter on employment status — such a person still appears on the muster-room
  and FTW displays if they tap and file.
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

### Late FTW uploads — shipped

- **A reading uploaded at or after its shift's `ftw-deadline` is `late`, and
  `late` does not pass** (owner, 2026-08-30). Live data: 50 such uploads on
  2026-08-30, 398 on 2026-08-29 — this is the common case, not an edge one.
- **Why it is a rule rather than an accident of timing.** The `ftw-ingest`
  window closes minutes after the gate, but the _night_ pull covers today as
  well as yesterday, so a 05:19 upload lands in the table by the afternoon
  anyway. Without this rule the same board regenerated at 17:00 would place
  people it refused at 05:25 — a board whose answer depends on when the button
  was pressed. Reading `sent_at` makes the answer a fact about the morning.
- **`late` is its own verdict, not folded into `fail`.** `fail` is a medical
  answer (savera judged the person unfit); `late` is an administrative one
  (nobody judged them in time). Only the second is worth escalating, and a
  screen that showed both as "gagal" would send a supervisor looking for a sick
  operator who is standing in front of them, fit, holding a phone.
- **The escalation is manual and already had its button.** The candidate dialog
  shows late uploads in amber with the upload time — "FTW telat 05:19" — and a
  supervisor may place them, exactly as with any other refusal. The Fit To Work
  sync pulls the reading in on demand; the timeline was not changed.
- **`ftw-deadline` stops being a no-op marker** and becomes the rule for
  `late`. Move it and the rule moves. `null` is a refusal to generate, the same
  as a missing `finger-in`: with no configured deadline there is no such thing
  as late, and treating every upload as punctual would re-open the hole.
- A reading with no `sent_at` is judged on its verdict alone — inventing
  lateness from a null would fail people for a gap in our own record.

### The IN tap is split at noon — shipped

- **A day holds two shift-starts, so one "first IN" cannot serve both**
  (owner, 2026-08-30). `finger_readings` now carries `first_in_at` (the first
  IN before 12:00) and `first_in_pm_at` (the first at or after it). Resolve
  with `shiftIn(reading, shift)` — never `firstInAt ?? firstInPmAt`, which is
  the bug itself written as a fallback.
- **The bug it closes, from live data.** `distinct on (nik, tanggal) ... asc`
  took the earliest IN of the calendar day. A night worker finishing the
  previous shift taps OUT at 06:20 and presses IN as well; that 06:20 then
  stood as their arrival for the _evening_ shift, comfortably inside a 17:15
  gate. Six such rows on 2026-08-30 — and re-judged against the correct tap,
  three change verdict: two to `missing` (they went home and never came back)
  and one to `late` (real tap 17:16:11, one minute past the gate).
- **The error direction is what makes it worth fixing.** It passed people who
  had not arrived. A board that quietly seats an absent operator is worse than
  one that refuses a present one, because nobody goes looking.
- **Noon is a fixed hour, not a configured stage** (owner, 2026-08-30). No
  timeline stage marks where a night begins, and adding one costs more than it
  returns. The two tap clusters — 04:00–07:00 (1,128 rows) and 15:00–18:00
  (719) — leave a six-hour gap no plausible gate crosses.
- Only the IN is split. A shift's OUT is unambiguous and nothing judges it.

### The Attendance screen is roster-driven — shipped

- **A row is a shift, not a tap** (owner, 2026-08-30). The list is the union of
  every IN tap in range and every roster day that says `D` or `N`. Driven by
  taps alone, someone scheduled who **never tapped at all** had no row: the one
  screen whose job is to notice them could not. Live data for 2026-08-30: 1,833
  tap rows and **326 scheduled-but-absent rows that did not previously exist**.
- **Two contradictions are reported, and only two.** Scheduled and absent (red,
  sorted first — it is the only row here that can leave a unit without an
  operator at 05:30), and present but not scheduled (amber, row tinted). What a
  tap _means_ against a shift still belongs to the allocation engine.
- **A null roster code is not a mismatch.** 2,507 of 3,933 taps come from NIKs
  with no employee record — non-mining, and they will never have a roster.
  Flagging `code NOT IN (D, N)` would light up two thirds of the screen every
  morning to report a gap in our own records as though it were the tapper's
  anomaly. They stay visible, unflagged, with a dash for a roster.
- **Check-out is gone.** It existed only because a reading is keyed by
  (`nik`, `date`), so a night shift's 06:00 checkout landed on the _next_ date
  as a row with no arrival — 461 of them, needing a `checkoutOf` lookup to
  explain they were not faults. One row per rostered shift dissolves the
  question rather than answering it: the night shift's IN is on its own roster
  date. 124 OUT-only rows on 2026-08-30 stop being rows.
- **The roster join now requires the active document.** It did not before, so a
  re-uploaded month held two rows per (employee, date) and the lookup kept
  whichever arrived last — the archive silently overruling the roster in force.
- Depends on a real roster. This was not worth building against the dummy
  all-`D` August: every day read as 990 scheduled and ~660 present, and the
  mismatch bucket cannot exist when every code is `D`.

### The dashboard — shipped

- **Composed server-side, in one request** (owner, 2026-09-01). Every card is a
  count, and a screen that opened with a dozen round trips would spend longer
  assembling itself than reading anything. The whole payload takes ~80 ms.
- **Two gates, and they are not the same gate.** A _grant_ decides whether a
  section is sent at all; _scope_ decides how much of it. Both live in the API,
  because a card the web merely declines to render has still arrived over the
  wire. A withheld section is `null`, never zero — zero and "not yours to see"
  must not look alike.
- **People-shaped sections are scoped, machine-shaped ones are not.**
  Attendance, FTW, SIMPER and the personal strip go through `scopeWhere`, which
  fails closed: a `self` account with no NIK reports on nobody rather than on
  everybody. The unit register, the board, the kiosks and the ingest clock
  describe the site rather than a department — and the fleet board spans
  departments by design (the `manpower` scope correction, D8) — so their gate
  is the grant alone.
- **The denominator is the shift, not the roster.** 990 people carry a roster
  row for a given day; 322 of them are off, on leave, travelling or sick. Only
  `D` and `N` schedule a shift, so presence is read against 668. Counting
  against 990 would make an ordinary day look like a crisis, every day.
- **A `self` account gets its own day, not a smaller version of the site's.**
  Roster code, FTW verdict, tap time, the unit today's board seated them on,
  and anything they are waiting on. An aggregate over a department means
  nothing to an operator; "you are on D, you tapped at 04:45, you are on
  DT4023" is the only line on the page they can act on. Everyone else gets the
  strip too, because everyone has a shift.
- **One card exists because nothing else would ever show its number:** _Units
  outside every fleet_ — held by a standing operator, claimed by no formation.
  The signature of a configuration gap rather than a deliberate omission, since
  a grader kept out of the fleets carries no standing pairing either. Shown
  only when non-zero; during setup it was 289.
- **Unmatched source readings were a second such card, and were taken out**
  (owner, 2026-09-01). A reading whose NIK matches nobody is not an error
  anywhere — it is simply skipped, by these counts, by the attendance table,
  and by the allocation engine's candidate pool. On 2026-09-01 that was 101 of
  344 FTW rows and 531 of 1155 taps, so every other figure on the page is
  quietly computed over the remainder. The finding stands and is worth chasing;
  the dashboard is simply not where it is reported.
- **The SIMPER card is withheld until the dates exist.** Every active employee
  carries a SIMPER _type_ and exactly one carries an expiry date, so a card
  counting zero out of nothing would read as "all clear" — the opposite of the
  truth. The section appears on its own the day the dates are imported.

### Allocation is scoped to formations — shipped

- **A unit takes part when it belongs to a formation** (owner, 2026-08-31): it
  leads one (`fleets.digger_unit_id`) or it hauls for one (`fleet_units`).
  That is the whole rule. Before this the engine was driven by `units` alone
  and built a **447-slot board against 15 units in a formation**, where every
  bus, forklift, lowboy and ambulance was a permanently idle vacancy nobody
  would ever fill.
- **The old "Unit support" filter was a residual, and its name lied.** It meant
  "in no fleet" and held most of the register — dump trucks, excavators,
  dozers. Those are production units nobody had paired to a formation yet, not
  support machines. It is gone, and so is "Semua fleet": the formation filter
  is now purely what Fleet Setting holds, so every option names a decision
  somebody made.
- **No-fleet is a visibility bucket, not a second scope** (owner, 2026-08-31).
  It holds every active unit that belongs to no formation, and the engine
  ignores it entirely — the focus is the units that are in a fleet. It exists
  so a machine cannot fall out of allocation unnoticed, which is a question
  about what an operator can see rather than about what the engine computes.
- **PLAN and the engine have different scopes, and the difference is the
  point** (owner, 2026-08-31). The PLAN board carries the whole active
  register, with the no-fleet entry as an option in its formation filter, so a
  standing pairing can be set on any machine: "operator A holds 4019" is a fact
  about a person and a machine, true whether or not 4019 is in a formation
  today. The engine reads only formations.
- **So an operator whose standing unit has no formation becomes a spare.**
  `buildBoard` scopes `planned` to formations, so their pairing never counts as
  holding a slot, and they fall into the spare pool — which is exactly what an
  empty seat in a fleet needs. An operator whose unit _is_ in a formation keeps
  it first, before any spare is offered anything. Both still follow the roster:
  it decides who is a candidate at all, and being a spare is not a way around
  it. Four tests pin this, including the one that would catch a spare
  outranking a formation's own holder.
- **The board's summary counts the selected formation, not the register.** With
  the whole register on PLAN, a total of 447 beside a screen showing one
  eight-unit fleet describes nothing anybody is looking at.
- **A spare card carries the SIMPER codes its operator holds** (owner,
  2026-08-31), delivered with the board rather than fetched per operator — the
  pool is several hundred people. The badges are deliberately _smaller_ than
  the department badge: the department says who an operator belongs to, the
  codes say what they may drive, and several of the second only fit beside one
  of the first if each is slighter.
- **Six badges, then a count.** The register runs from one code to
  twenty-three; most operators hold two or six. A card rendering twenty-three
  would stand several times the height of the ones beside it and break the
  grid, so the rest becomes `+N` with the full list on the card's tooltip.
- **The pool is filtered by code and paged.** The code filter is a set of
  checkboxes, not a single choice — an operator holds several, and the question
  behind it ("who can drive this") is answered by _any_ of the ticked codes
  rather than all of them. Paging exists because the pool is the whole
  allocatable workforce minus whoever is paired, on a screen whose subject is
  the units above it.
- **Its membership is derived, never stored.** Formations are reshuffled often,
  and a stored list of "everything else" goes stale the moment one is edited —
  silently, because nothing about a stale row looks wrong. Deriving it makes
  the entry correct by construction: a unit pulled out of a fleet is in it on
  the next read, and one added to a fleet leaves without anyone remembering.
  `no_fleet_units` was dropped in `0020` (verified empty first).
- **So there is nothing to edit, and nothing to delete.** The entry is
  read-only: an editing endpoint could only ever disagree with the formations
  it is computed from. It stays pinned above the formations in Fleet Setting,
  and "cannot be deleted" remains a property of having no record behind it.
- **A unit is configured in exactly one place.** `fleets.leader_unit_id` is
  unique and `fleet_units.unit_id` is unique across the table, so joining on
  either can never double a card.
- **A fleet's bus is deliberately not in scope by being a bus.** It is crew
  transport rather than a machine the pool crews — across every board generated
  so far, all 52 bus slots were empty — and two buses serve more than one
  formation, so a bus has no single fleet to be filed under.
- **Support units are in scope, and grouped apart** (owner, 2026-09-04). A
  dozer, a water truck or a spare digger is crewed like anything else; what it
  lacks is a formation, not an operator. `units.fleet_support` — set by the
  import from a row that names no fleet — is what puts them on the board, and
  they arrive as one **Support** group that sorts after every formation, on the
  Actual board and on the TV alike. Never mixed into a pit somebody is standing
  in front of.
- **The flag is set, not derived.** A unit falling into scope because a text
  column stopped being empty is exactly the accident it exists to prevent.
- **The cost that remains, accepted knowingly.** An active unit the import
  never names is not allocated and is not reported idle either — it goes quiet
  rather than loudly empty. This is the failure `allocation.ts` was rewritten
  to escape once before, when a PLAN-driven board hid nine of fifteen units.
  What answers it is the no-fleet entry: the units are listed, in Fleet
  Setting, where someone deciding formations is already looking.

### Spares are offered in two tiers — shipped

- **An operator who holds no unit anywhere is offered a vacancy before one who
  does** (owner, 2026-09-01). Everyone in the spare pool is unattached _today_,
  but not for the same reason: some hold nothing at all, others hold a machine
  that is broken down, on standby, or in no formation. Seating the second group
  on somebody else's unit is the expensive placement — when their own machine
  comes back, taking it means pulling them off a seat and opening a fresh
  vacancy mid-shift, which the application does not handle and a supervisor
  sorts out by hand.
- **Ordering, never filtering.** If no unattached spare can take a unit — wrong
  SIMPER, wrong department, none left — a standing holder still gets it. A seat
  left empty beside somebody able to fill it would cost far more than the
  reshuffle this avoids. A test pins exactly that case.
- **The price: first-come-first-served no longer holds across the whole pool.**
  An unattached spare who tapped at 05:10 now outranks a standing holder who
  tapped at 04:48. Accepted knowingly; the tap still orders each tier
  internally, so "arrive early" keeps its meaning within a tier.
- **Measured on the 2026-09-01 day board**: all 14 spare placements moved to
  operators holding no standing unit (four had previously gone to standing
  holders), and the number of filled seats did not change — 16 either way. The
  reordering cost no coverage.

### The board's audit table — shipped

- **One line per operator the roster put on this shift, and what became of
  them** (owner, 2026-08-31), under the Actual detail's history. Columns:
  fleet, plan unit, operator, SIMPER codes, FTW verdict, finger check-in,
  actual unit. It exists so the two questions behind every disputed slot — did
  they pass FTW, did they tap — stop being answered by opening two other menus
  and matching NIKs by eye.
- **The row is the person, not the slot.** "Plan unit → actual unit" is a
  movement, and a movement needs someone to move. Units nobody filled are
  already on the board above, so the table does not repeat them.
- **The fleet column is where they _worked_, falling back to where they
  belong** (owner, 2026-09-01). A spare who filled a seat in EX4001 worked
  EX4001 that shift, so filtering a formation answers "who was this
  formation's business today": its standing operators, including the ones it
  lost, and whoever drove its units in their place. Inside a formation the rows
  read unit by unit, with the operators the board placed nowhere following.
- **The actual unit closes the row, and carries the decision in its colour**
  (owner, 2026-09-01). Green kept the unit they stand on, amber came in to fill
  one, red left the shift without a machine and reads `NO UNIT` — a badge
  rather than a dash, because "nobody gave this person a unit" is a finding,
  not a blank. It is the only coloured cell in the row and the answer the whole
  line was building towards, so a separate decision column was dropped as a
  second way of saying the same thing. The word stays on the tooltip, which is
  what keeps a spare and a supervisor's placement — both amber, as on the fleet
  wall — distinguishable to anyone who asks.
- **The check-in column sorts** (owner, 2026-09-01): click for earliest first,
  again for latest, again to return to the formation order. Earliest-first is
  the direction the engine itself works in — it offers vacancies to spares
  first come first served by the tap — so the sorted table replays the order
  the decisions were made in. Operators with no tap sit at the end whichever
  way the column points: a missing tap is neither early nor late, and putting
  it first on the reverse would parade the people who never arrived above
  everyone who did.
- **Rows within a formation read by decision, not by unit code**: the seats it
  filled, then the people it turned away. Reading a fleet is asking "who is on
  it, and who should have been" in that order; sorting by unit interleaved the
  two and made the second question something to hunt for. Unit code is the
  tiebreaker, so each block still runs unit by unit.
- **The five decisions come from the engine's stored `source`**, never from
  comparing unit codes — only the source can tell a spare who landed on their
  own unit from a holder the plan kept. `not-ready` and `no-seat` stay apart in
  the data even though both render red: when a formation runs short, somebody
  turned away by FTW is a different problem from somebody ready with nowhere to
  sit.
- **The FTW column reports the verdict the engine used for that person, not
  the pool's default.** `candidates()` judges everyone as though FTW were
  required, and a unit that does not require it has the engine ask again — so
  the table applies the rule of the unit they were placed on, or failing that
  their standing unit. Without this a digger with `ftw = false` showed "no
  reading" beside an operator the board had happily seated, and the table
  contradicted the thing it exists to explain.
- **The roster is the gate, and it is the engine's own call** (`candidates()`),
  so the table can neither explain a decision about somebody the engine never
  considered nor omit somebody it did.
- **No standing unit reads SPARE, not a dash.** It is not missing data — it is
  what a spare _is_.
- **Formations first, spares last.** A spare here is anyone with no formation:
  no standing unit at all, or a standing unit that belongs to none.
- **Filtered by formation, FTW verdict, finger verdict, and SIMPER code**
  (owner, 2026-09-01). The formation filter carries one entry beyond the
  formations themselves — the rows in none of them, where every spare and every
  no-fleet unit's holder sits, which is the bucket somebody scanning for "who
  was left over" actually wants. The first three are single choices, because a row has exactly one
  verdict and "pass or fail" asks for everything; only SIMPER is a set of
  checkboxes, because an operator holds several codes at once. Each filter
  offers only what the board actually contains — a verdict nobody on this shift
  has is a choice that can only empty the table. The code filter is ANY, not
  ALL: a unit asks for one code, so holding any of the ticked ones is what
  makes an operator relevant. That checkbox control now also serves the spare
  pool on the PLAN board, extracted rather than written twice.
- **The readiness columns are read as they stand now, not as the engine saw
  them.** `fleet_actual_slots` records outcomes, not the verdicts behind them,
  and readings keep arriving after generation — the 2026-08-30 day board was
  built at 05:20 and 711 of that date's FTW rows synced afterwards. So these
  columns agree with the Fit To Work and Attendance menus, which is what they
  are here to replace, and can differ from what the engine saw. The panel says
  so above the table rather than leaving it to be discovered.

### The allocation engine — shipped

- `spare-validate` is no longer a no-op. It builds and stores one shift's
  board: **every active unit** (minus `breakdown` and `standby`, which need no
  operator), its planned operator kept if they pass, and every vacancy offered
  to the spare pool **first come first served by `first_in_at`**, subject to
  the same SIMPER and department rules PLAN enforces.
- **The board is driven by `units`, not by `fleet_plan_slots`.** It was the
  other way round at first, and that hid the units most in need of showing: a
  unit the plan has no standing pairing for is idle by default, and it never
  appeared as a vacancy at all. On the site's first real board nine of fifteen
  units were invisible, and it reported one idle unit while ten had nobody on
  them. PLAN answers "who usually drives this", never "which units exist".
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

### The Actual tab — shipped

- The tab lists the generated boards (newest first, with the **idle count**
  spelled out — the number the screen exists for), and one board opens unit by
  unit with vacancies as rows like any other.
- **Editing is unconditional.** The board is never frozen, so there is no state
  in which a supervisor is told the morning is closed. A person placed by hand
  is recorded as `manual`, never as `plan` or `spare`: the board must not claim
  the engine chose someone it did not.
- **The candidate list shows refusals rather than hiding them.** Every operator
  rostered to the shift appears, with the readiness verdict and the eligibility
  rule's own words beside them. Someone overriding the engine is entitled to
  see what the engine saw — and may place a person it refused, which is the
  point of an override. `ready` is the readiness verdict alone and is not
  "may take this unit"; the refusal is a separate axis.
- One person, one unit per board: enforced by a partial unique index and
  answered as a 409 naming the unit they are already on.
- Generating from the screen **replaces**, the same as the timeline stage, and
  refuses when the shift has no active `finger-in` deadline rather than
  defaulting to one.
- The static port's mock (`ACTUAL_INIT`) and its "create then lock" flow are
  gone. There was never a lock — the board is generated twice a day and stays
  editable.
- **A board carries its own copy of the formations it was built in** (owner,
  2026-09-04). Generating writes the digger code, work area and bus code of
  every formation onto the board itself (`fleet_actual_fleets`), and the Actual
  menu, its audit table and the fleet TV all group by that copy rather than by
  Fleet Setting. Fleet Setting describes today and is legitimately rewritten
  between shifts — five formations in the morning, three different ones at
  night — while a board describes a shift that has already happened. Reading
  the second through the first erased the morning board from the wall when a
  formation was disbanded, and silently relabelled it with a later work area
  when a digger was reused.
- **The copy is a copy, not a link.** Disbanding a formation leaves the board
  intact and only clears the breadcrumb back to Fleet Setting. Boards generated
  before this shipped carry no copy and read as "no formation": that record was
  never written, and borrowing today's is exactly what the defect was.
- **A TV scoped to particular formations shows only boards it can still match.**
  A screen's picks name live fleets, so a board whose formation has been
  disbanded drops off that screen — it was pointed at a pit that no longer
  exists, and guessing a match would put the wrong pit on the wall. The board
  still shows in full on an unscoped screen and on the Actual menu.

### The fleet wall (Display Fleet) — shipped

- **The wall shows the Actual board of whichever shift is running**, one
  formation at a time. The static mock it replaced showed nothing real.
- **Nobody picks the date or the shift.** A TV in the yard has no operator, so
  the API answers from the clock, and from the master timeline: a shift takes
  the screen at its **first** stage, `ftw-ingest` (04:45 and 16:45 today) —
  when its changeover _begins_, not when its board is finished. The people the
  wall is for are walking to the gate; they need their unit before the line-up
  is final. Before the morning gate the running shift is the night one that
  began **yesterday**, because a night board is filed under the date it
  started.
- **Between the changeover opening and `spare-validate`, the wall shows the
  standing PLAN instead of nothing** (owner, 2026-08-29), rendered visibly
  unfinished — dimmed, desaturated, dashed, with "Line-up sementara" in the
  header. There is a real ten-minute gap twice a day, and it is the exact
  window in which arriving operators most want to know their unit; a blank
  screen there is the least useful thing the wall could do. The provisional
  state persisting past `spare-validate` is also the standing alarm that
  nobody generated the board.
- **The provisional line-up takes its shift from the roster, not the plan.**
  `fleet_plan_slots` holds no shift: a unit may carry two standing operators,
  and which is today's is settled by each one's `roster_days` code for the
  date. A unit whose planned operator is off shows unmanned rather than
  showing the wrong name.
- **No deadline, no guess.** A missing gate, or a night gate that does not fall
  after the day gate, leaves the wall saying the timeline cannot decide —
  never a plausible default. The same refusal `fingerInDeadline` already makes.
- **The endpoint never fails on an empty answer.** "No board yet" and "the
  timeline cannot say" are readings the screen states out loud; an HTTP error
  would render as a blank TV and send someone looking for broken hardware.
- **Grouping is the formation**: digger first, then its haulers by code.
- **Units belonging to no fleet never reach a TV** (owner, 2026-08-29). The
  wall answers one question — how each formation is crewed — and a unit in no
  formation has nothing to contribute to it. They stay on the Actual board,
  which is where a supervisor sees and fills them.
- **The counts in the header are the formation's own, never the site's**
  (owner, 2026-08-29). Someone standing in front of the Pit 3 screen acts on
  Pit 3; a site-wide number there would be read as that fleet's and be wrong.
  They cover the whole formation even when it spans two pages, so the header
  does not recount itself every twelve seconds.
- **Idle units keep a full-size card, in red, in their own formation.** They
  are never summarised into a count or paged off the end; a unit standing idle
  is the only thing here that costs money by the hour.
- Breakdown and standby units do not appear: the board excludes them by
  design, and the wall shows the board.
- Readable by a paired `fleet` device or by a signed-in holder of
  `display-fleet`, the same `allowDevice` shape as the other kiosks. Polled
  once a minute — the board only moves when someone corrects it.

### Per-screen configuration — shipped

- **Each TV is pointed at its own formations** (`device_fleets`), picked from
  the real Fleet Settings list. Many TVs, one per pit, each showing the fleet
  it hangs beside — which is the reason the registry lets you add more than one.
- **No rows means every fleet**, the same "having rows" bargain
  `device_run_texts` strikes with the master texts. A screen nobody has scoped
  is a control-room screen, not a blank one, and that is also why the table
  carries no `active` flag: deleting the last pick and switching it off would
  otherwise be two ways to say one thing.
- **A signed-in person is never scoped.** They are previewing the wall, not
  standing in the pit it hangs in, so they see every formation.
- **A pick is refused on any screen that is not a fleet wall**, and on a fleet
  that no longer exists. Storing either would leave a setting that looks
  configured and does nothing.
- `cascade` both ways: a device's picks die with the device, and a fleet
  disbanded in Fleet Settings leaves the TVs that showed it rather than
  blocking its own deletion with an error about a television.
- **Rotation dwell is per screen** (`devices.rotate_seconds`, default 30,
  bounded 3–600). A TV showing one fleet has nothing to rotate to and a long
  dwell costs it nothing; a control-room screen carrying every formation needs
  to move along. `?interval=` still overrides, so a preview can be hurried
  without touching what the TV in the yard is set to.
- `GET /v1/fleets` is readable from `display-fleet` as well as `fleet-setting`,
  because that is where a wall is pointed at its formations. Only the list:
  creating, editing and disbanding a fleet stay `fleet-setting` alone.
- `lib/display-data.ts` — the last of the display sample data, four invented
  fleets whose selection was discarded on submit — is gone.

### A fleet wall is a slideshow or a monitor — shipped

- **Each fleet TV declares how it spends its screen** (`devices.layout`,
  default `slideshow`). A `slideshow` is the original wall: one formation fills
  the glass. A `monitor` puts **four** formations side by side.
- **Default `slideshow`, because that is what every wall already registered
  is.** A default that quietly re-laid out the screens hanging in the yard
  would be a migration nobody asked for.
- **Four is a page size, not a ceiling** (owner, 2026-08-31). Neither layout
  caps how many formations a screen may be given; a monitor holding more than
  four rotates a page of four at a time, exactly as a slideshow rotates one
  fleet at a time, and at the same `rotateSeconds`. A screen given nine shows
  three pages of four, four, and one.
- **Four per page, because the grid it implies is 2×2.** On the 1920×1080
  canvas the walls run at, that is ~950×480 a quadrant, which still carries a
  unit code and a full name at a size worth mounting a television for. Six
  would fit geometrically and be unreadable in the yard.
- **A monitor's grid does not reshape itself on the last page.** Nine
  formations end on a page of one, and stretching that one across the wall
  would resize every card as the page came round — on a wall that turns every
  thirty seconds, a card that changes size reads as a different card. Only a
  monitor that never turns fits its grid to what it holds.
- **A monitor drops the summary tiles** (owner, 2026-08-31). Unit Aktif /
  Teralokasi / Tanpa Operator / Spare describe _the_ formation on screen, which
  is a sentence a slideshow can say and a monitor cannot — its screen is about
  four. Each quadrant carries its own counts in its own header instead, and the
  height the tiles were taking goes back to the cards.
- **Pick order is now stored** (`device_fleets.sort_order`) and is the screen's
  order: the rotation sequence on a slideshow, the page and the quadrant on a
  monitor. Alphabetical-by-digger was adequate while a wall showed one fleet at
  a time, but on a monitor it decides which pit lands top-left — and that is a
  choice the control room makes, not the alphabet.
- **A quadrant is always two rows of cards; the columns follow the formation.**
  Card _height_ therefore stays fixed across all four quadrants — a five-unit
  fleet gets wider cards instead of leaving half its quadrant empty, and a
  fourteen-unit fleet narrows instead of spilling. Because the grid holds
  `2 × ceil(n/2) ≥ n`, nothing is ever cut, and the wall keeps its promise that
  an idle unit is never summarised away.
- **Each quadrant names its formation the way the yard does**: `Fleet <digger>`
  with the work location beside it, then the bus and the digger as badges and its
  own counts (`n unit · n siap · n kosong · n spare`). A quadrant whose
  formation has an empty seat outlines itself red, so a missing operator is
  visible before a single card is read.
- **A monitor turns by flipping its panels, not by sliding them** (owner,
  2026-08-31). Four panels sliding together reads as the whole screen jumping;
  four panels flipping in place reads as each quadrant changing its own
  contents. One turn is a three-phase machine — hold, close, swap, open — with
  a 70 ms stagger between quadrants, and the animation's durations live in the
  page rather than only in CSS because the scheduler has to know when a panel
  has finished closing before it swaps what is inside it. Under
  `prefers-reduced-motion` the pages still turn; only the flip is dropped.
- **Blank quadrants on the last page are rendered, not collapsed.** Nine
  formations end on a page of one, and dropping the three blanks would move
  every formation between turns — a crew who knows theirs appears bottom-right
  would have to rescan the wall every time it came round.
- **Each layout heads itself with what its screen is about** (owner,
  2026-08-31). A slideshow is about one formation, so it reads
  `Fleet <digger>` over the work location and the bus. A monitor is about four, so
  no formation can name it — it takes the screen's own registered name
  (`devices.name`, now delivered with the board) over
  `Halaman 1/3 | fleet 1–4 dari 9`. Both keep the shift badge — the wall turns
  from day to night by itself, so only the header can say which one is up — and
  the provisional warning, which is an alarm rather than a label. The
  "digenerate HH:MM" line and the name badge on the right are gone: a monitor
  already carries its name in the heading, and on a slideshow the badge
  answered a question the formation title had answered. The other kiosks keep
  their name badge; they have no name in their heading.
- **A monitor shows page dots, a slideshow shows the progress bar.** From a
  distance the dots are what tell a crew their fleet is coming round shortly;
  without them the wall reads as four formations changing on their own. The
  segmented story bar stays on the slideshow, where one segment is one subject.

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
