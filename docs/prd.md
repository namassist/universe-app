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
- Deleting a fleet releases its members and clears the work area and transport
  it gave them — the units survive and are immediately offerable to another
  formation. Untouched was the right rule while those columns lived on the
  fleet and died with it; on the unit it became "keeps asserting something
  nobody said".
- **The support entry is writable by hand, and the no-fleet entry is not.** The
  difference is what each one _is_: no-fleet membership is derived, so an
  endpoint could only ever disagree with the formations, while support is a
  stored flag with an area and a ride beside it. Until 2026-09-04 only the daily
  import could set them, and a dozer moved to a new panel at ten in the morning
  had nowhere to be recorded. Adding states what the units are rather than
  appending to a list, so pressing save twice changes nothing — and silence
  about a unit's vehicle means it has none, rather than keeping the old one.
  Releasing clears the same three columns the import's sweep does.
- **Work area and transport are both per unit there.** A support group is not a
  formation: two dozers may work on different panels and be brought by
  different buses, so the dialog offers a row per selected unit carrying both,
  with a "samakan semua" shortcut for the case where they are alike. The rule
  that an area must be one value belongs to formations, and stays there.
- **Joining a formation ends support**, or the entry would keep claiming a
  machine listed under its fleet.

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
- **A broken digger's trucks must be moved, not parked** (owner, 2026-09-15,
  reversing 2026-09-08). When a digger reads BREAKDOWN, the admin seats its
  trucks in another formation in the same file. A truck row that still names
  the broken digger is refused — with a blank area ("Fleet EX4001 breakdown —
  pindahkan DT4027 ke fleet lain") or with one — and the import cannot be
  committed until it is fixed. A blank area on a row that names no formation
  stays what it always was: an error.
- **`STANDBY` in `area` marks a unit standby and changes nothing else** (owner,
  2026-09-15). The unit leads, hauls or supports exactly as its row says,
  keeps the ride the file gives it, and is **still allocated**. Matched like
  BREAKDOWN, spaces removed and case folded; the word is kept as the unit's
  area. Any other text is a work area — the yard's older `STBY TUNGGU INFO`
  included. Every row the file writes sets or clears the flag from its area.
- A formation whose digger is down **does not survive the day**. The digger
  files as a broken machine in no formation, and the formation is disbanded —
  to be recreated by the next file that seats it.
- **Every flag the import can set, it can clear.** Seating a unit in a
  formation or crewing it as support clears `breakdown` and `standby` alike.
  Allocation skips both, so a flag left standing would keep a working machine
  off the board with nothing reporting it — the same failure `breakdown` had
  until 2026-09-05.
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

### Allocation priority (Prioritas Alokasi) — shipped

- **The problem** (owner, 2026-09-09). The engine filled vacancies in unit-code
  order, which is not a decision about which machine matters — it is an
  accident of naming, and here a systematically unlucky one. Excavator codes
  run smallest-first (EX2xxx SMALLDIGGER through EX7xxx BIGDIGGER), so the
  biggest diggers were reliably crewed last. The yard's rule is the opposite:
  biggest first.
- **The orderable row is a (unit class, SIMPER code) pair**, because neither
  half is enough alone. A class is too coarse — SMALLDIGGER spans a 20-tonne
  ZX200 and a 47-tonne ZX470, and the EX4011 that prompted this is a
  SMALLDIGGER. A code is too coarse the other way: `K460 6x6` covers a crane
  truck, a fuel truck, a service truck and a water truck. 55 pairs cover 450
  active units.
- **One ordering across every type, not one per type.** 342 operators hold both
  DUMP TRUCK and REAR DUMP TRUCK codes, so the commonest tie of all is between
  two types; a per-type list would leave it undefined and fall back to the very
  unit-code order this replaces. The screen groups by type only to be readable.
- **`rank` is a priority, not a size.** Nobody has to decide whether a 60t dozer
  is "bigger" than a 100t dump truck; they decide which to crew first when
  operators are short, and that is a judgement rather than a measurement — which
  is why it is admin input and not derived from the class name. The names could
  not carry it anyway: tonnes for trucks, words for diggers, feet for graders,
  kilolitres for fuel trucks.
- **The list is generated, only the ranks are stored.** Rows come from the
  distinct pairs among active units, so a pair introduced by a new model turns
  up on its own, marked unranked, and a pair whose last unit is retired stops
  being offered with nothing to clean up. **Unranked sorts last**, never first —
  a model imported this morning must not take a seat from a machine somebody
  deliberately placed.
- **It only breaks ties between vacancies.** Step 1 of the engine seats each
  unit's own planned operator with no competition; the order matters only in
  step 2, where a spare is offered the first vacancy they fit. Ties inside a
  rank fall back to the database's own `asc(code)` — carried as each slot's
  index rather than re-compared here, because Postgres and `localeCompare` do
  not order these strings alike and re-deriving it reshuffled boards that had
  no priorities set at all.
- The 18 active units carrying no SIMPER code are a pair of their own rather
  than a missing row: they are still machines somebody has to crew.
- **The seed lays down a first order**, so nobody ranks the pairs from an empty
  screen. The class order is the owner's own (2026-09-09) and is written out
  rather than derived, because it is a decision and not a measurement — and
  because no rule could produce it: it interleaves types (REARDUMP100T,
  DUMPTRUCK100T, REARDUMP60T, DUMPTRUCK60T), which is also the plainest
  evidence the ordering has to be one list rather than one per type. Names are
  matched exactly as the register spells them, duplicates included
  (`FUELTRUCK20KL` beside `FUEL TRUCK 20KL`) — tidying the register is a
  separate job from recording the order it is worked in. Within a class the
  SIMPER code's own number decides, `EXC CAT 6020` over `EXC 1200`. A class the
  list does not name arrives unranked rather than first. **It runs only when
  the table is empty**, so an order somebody has adjusted is never overwritten
  by a re-seed.

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
- **The crew list under the Plan board** (owner, 2026-09-16). A table under
  the board, replacing the pool of spare cards, which described only the half
  of the workforce that holds nothing. **One row is a unit**, not a person
  (owner, 2026-09-16, after the first build read the other way): the fleet
  setting, the board and this table must name the same machines, and a
  person-shaped row dropped a whole unit from the list the moment both its
  operators were on leave — which is the machine somebody opens this screen to
  find. Every unit the board carries has a row, including one nobody is paired
  to; the spares follow, one row each, marked SPARE in the unit column the way
  their slip reads.
- **What a row states:** its operators (name, NIK), their departments, their
  SIMPER codes and their roster codes today, then the unit's own fleet with
  its area, and the unit code. A unit's two operators are
  two lines of the row — rendered as two `<tr>`s with the unit's cells merged
  across them, so each operator lines up with his own department, permits and
  roster code. Units first, by formation then code; spares after them by name.
- **Filters,** in that order — the people first, then the machines, with the
  search last: units/spare, today's shift, SIMPER code (several), department,
  fleet, and a search over operator name, NIK **and unit code**.
  The fleet column and its filter never read a unit outside a formation as an
  absence: it says **Fleet support** or **No fleet**, the two groups the
  board's own fleet filter offers, because both are answers the fleet setting
  gave rather than a gap in it. A row matches when any of its operators does.
  The unit's own status (Ready / Standby / Breakdown) is deliberately not here
  (owner, 2026-09-16): the board states it on the card, and this table is about
  who is on the machine.
- **The table is scoped the way the wall is.** A unit reads _Kosong_ only when
  allocation is about it at all — active, not broken down, and in a formation
  or flagged support, the same `fleet-scope` rule the engine and the
  provisional wall apply. Everything else keeps its row, marked **Di luar
  alokasi**, because the fleet setting gave it an answer and a machine should
  not go quiet unnoticed; but nobody will ever be sent to fill it, and counting
  it made the vacancy figure roughly double what the wall would show (2026-09-16:
  109 real against 108 phantom).
- **Before `spare-validate` the table and the fleet wall agree**, unit for unit
  and name for name: the provisional wall is the same standing plan read
  through the same roster rule (`D`/`N` only). Afterwards they diverge by
  design — the wall becomes the board, where spares fill the vacancies and a
  failed FTW or a late tap costs the standing operator his unit. The table
  knows nothing of taps or FTW, and should not: it is what was planned, not
  what became of it.
- **The shift never removes a unit; it decides what "empty" means.** Choosing
  Siang or Malam keeps every unit on screen and marks the ones no operator
  works that shift — a unit whose day operator is on leave is exactly what the
  morning list is for, and the first build dropped it. A unit whose only
  working operator is on nights therefore reads empty at the morning muster,
  which is the truth of it. For a spare — a row about a person, not a machine
  — the shift still filters him in or out. A second control, **Hanya unit
  kosong**, narrows to the marked ones; the two read as one sentence: "the
  morning shift, only the units nobody is on". The shift opens on the
  shift being mustered, read from the clock at mount: Siang before noon, Malam
  after it. There is no filter on the roster code itself — the code is a
  column, so the _reason_ (CR, OFF, A, TGS) is read off the vacancy rather than
  searched for. The vacancy is marked on the unit's row, which the board cannot do:
  there its operators are still paired to it. The board's payload carries the
  date it read the roster for, and the table states it, because the roster
  column changes at midnight.

### FTW + attendance ingestion — shipped

- Both readiness signals are **snapshotted into local tables** (`ftw_readings`,
  `finger_readings`, keyed `nik` × `date`) — external sources are read-only
  and never queried from a request path; historical questions are answered
  locally.
- **FTW** comes from savera's `saverawatch` DB (`summary_insights_v2` +
  joins), manual uploads only, filtered to this site's company. The verdict
  is ingested as text (sleep minutes, sleep category, FTW decision) — savera's
  rules are operator-configurable, so re-encoding them here would drift.
- **Only people the employee register knows are kept** (owner, 2026-09-17).
  savera reports FTW for every driver on site, and a quarter of a morning's
  rows belonged to nobody in `employees` (187 of 714 on 2026-09-16) — read by
  no screen that decides anything, but listed raw by Monitoring FTW and its
  export. The pull drops them before writing, the same rule the booth pull
  applies to taps (`registered-niks.ts`, one definition for both), and counts
  them under `skipped`. Any employee counts whatever their status. Somebody
  added to the register later is picked up by the next pass while their date
  is still in the pull window (today and yesterday); older days are not
  back-filled. Rows already stored before the rule stay as they are (owner).
- **Monitoring FTW reads by colour** (owner, 2026-09-17): Tidak Boleh Bekerja
  (red), Istirahat (yellow), Dapat Bekerja (green), then Belum lapor — and
  inside each, the newest upload first. The day no longer leads, and a late
  upload no longer lifts a green row above the others. Clicking a column still
  replaces this order entirely.
- **Every row carries the roster's own code for its day** (owner, 2026-09-20).
  savera knows nothing of the roster, so its list showed a day operator's 04:26
  filing and a night operator filing early for tonight as the same kind of row.
  On 2026-09-20 two of the screen's first nine rows were rostered `N`, which is
  why it appeared to disagree with the dashboard's count of eight — the
  dashboard counts one shift, this screen counts uploads. The code rather than
  a shift, because `CR`, `OFF` and the rest answer "why is this person here at
  all", and a reader who can see `D` and `N` will ask it. Null when the roster
  holds nothing for that day; it is read once for the whole range, and the
  export carries it too.
- **Monitoring FTW lists who has not filed** (owner, 2026-09-17). savera sends
  only what was uploaded, so the "Belum lapor" category could never hold
  anyone. The list (and its export) now adds a row for every person rostered
  `D` or `N` on a day in the range who owes an FTW — the wall's own
  `ftwObliged` rule — and has no upload for that date at any hour; a late
  upload is an upload, flagged late, not a missing one. Such a row carries
  `rosterShift`, and is placed in Shift 1 or 2 by it, since it has no send
  time. These rows are what the fit-to-work wall counts as "Belum upload", so
  the two screens agree (2026-09-17 day: 12 on both). The FTW history page
  shows them too, as the days an operator did not file.
- **Attendance** comes from Nakula's raw tap log (`tbl_absen_all`), reduced to
  first IN / first OUT per person per day with device IPs — deliberately not
  Nakula's interpreted view (30 s a query vs milliseconds). Raw as recorded;
  shift-aware interpretation belongs to the consumer.
- **Timeline-driven, deadline-final:** the `ftw-ingest` and `finger-ingest`
  stages fire once and re-pull each minute — retry and late-arrival tolerance
  in one. A post-deadline upload does not count: the snapshot is final by rule,
  not stale. Manual sync routes (manage mode) cover pulls outside the timeline
  and recovery.
- **A pull runs until the deadline its readings are judged against**
  (2026-09-10) — `ftw-ingest` until `ftw-deadline`, `finger-ingest` until
  `finger-in`. A pull window is not a duration somebody chose; it is the span
  between a source becoming worth asking and the moment its answer stops
  mattering, and that second moment is already on the timeline. So a pull
  _stage_ is now **when pulling begins**, and widening the muster is a decision
  made on the Timeline screen rather than in a constant.
  - It replaced a fixed five minutes, which left the readings tables standing
    still for the rest of the morning — and with them the wall's two badges,
    which are computed from those tables on every request. The first honest
    picture of a shift arrived minutes before the bus left.
  - A deadline the timeline cannot name **falls back** to
    `INGEST_WINDOW_MINUTES` rather than refusing, and says which happened.
    Elsewhere a missing stage is a refusal; here pulling nothing empties the
    readings tables and takes every screen down with them, so the old five
    minutes is the floor.
  - One pass always runs before the clock is consulted, so a stage firing after
    its own deadline still pulls rather than concluding there is no time left.
  - Each pass logs how long the source took. Whether a cadence is affordable is
    a question about someone else's system; measured on production 2026-09-09
    at **~0.5 s for FTW and ~0.2 s for finger**, which is what settled the
    one-minute cadence.
- NIKs normalize digits-only / no leading zeros (savera's production-proven
  recipe) — the cross-system join key.

### Readiness on both shifts — shipped

- **FTW and fingerprint are required morning and night** (owner, 2026-08-29).
  The timeline is no longer the morning's alone: the day's six stages have a
  mirror twelve hours later (16:45 FTW, 17:15 finger, 17:25 spare validation,
  17:30 bus). Without an afternoon ingest a night worker's 15:00 FTW upload and
  17:00 tap are not pulled until the _next_ morning's run — about fourteen
  hours after a night board would need them.
- **The schedule is the yard's own, and the timeline now matches it**
  (owner, 2026-09-10). The site works to a flowchart with four gates — FTW
  upload, first tap, second tap, departure — and the application ran a
  different morning. The seeded times move to the flowchart's, in both shifts,
  twelve hours apart: shift start and FTW pulling at 04:00, finger pulling at
  04:30, FTW upload closing 05:22, first tap closing 05:25, the board at 05:26,
  the second tap at 05:28, departure at 05:30.
  - **`finger-second` is a new stage.** It is the tap a spare makes _after_ the
    board exists, to collect the unit it gave them, and the timeline had no
    vocabulary for it at all — so the one stage where a spare learns their unit
    existed on paper and nowhere else. It fires nothing yet; the printing that
    will hang off it is a later phase, and until then its value is that the
    screen people plan the morning on shows the morning they run.
  - **The board is built one minute after the tap deadline, not on it.** The
    scheduler ticks by the minute and nothing orders two stages within a tick,
    so sharing the minute would let a board be built before the last pull of
    tap data landed — a race that surfaces as a handful of operators
    mysteriously missing from a board they had tapped in for.
  - **Only new installations take the seeded times.** The seed inserts a stage
    it cannot find by name and never rewrites one, so a running site's schedule
    stays the operator's — which is the whole reason it is a table.
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
- **And it is _one_ shift, picked by the clock** (owner, 2026-09-18). Opened
  before noon the dashboard counts the day shift; from noon onwards, the night
  one. Every people-shaped figure obeys it — attendance, FTW, the personal
  strip, the "unit terisi shift ini" card and the attention panel — and the
  payload carries the shift it counted, so the screen labels the cards from
  the site's clock rather than the reader's laptop.

  Both codes used to land in one denominator. On 2026-09-18 at 07:15 that read
  "belum lapor FTW 408 dari 657" and "belum absen 657 dari 657", of which 324
  were night operators hours away from starting work: a red number printed
  every morning that nobody could act on. Shift-scoped the same moment reads
  332 rostered, and the FTW shortfall drops to 84.

  The boundary is noon rather than the `shift-start` stage, and deliberately.
  `currentShift` answers "which board does the TV in the yard show" and has to
  turn over exactly when the muster does; this one answers "which shift is the
  person at the desk asking about", where a configured stage would surprise
  them — at 13:00 an admin is looking ahead to tonight, not back at a day shift
  the timeline still calls current until 16:00. Noon is also the boundary the
  application already splits the day on everywhere else: `first_in_at` against
  `first_in_pm_at`, the FTW upload shift, and the plan board's crew table. The
  two live side by side in `current-shift.ts` as `currentShift` and
  `deskShift`. Between 12:00 and the night `shift-start` they disagree on
  purpose, and the dashboard says which one it used.

- **A tap is read from the shift's own column, never `a ?? b`.** The noon split
  exists because one date holds two arrivals; the fallback it refuses is a
  night operator's 06:20 wrong-button tap on the way home standing as their
  arrival for a shift that starts at 17:00. The personal strip and the seat
  lookup follow the same rule, so "you tapped at" and "you are on" are both
  about the shift the cards are about.
- **A `self` account gets its own day, not a smaller version of the site's.**
  Roster code, FTW verdict, tap time, the unit today's board seated them on,
  and anything they are waiting on. An aggregate over a department means
  nothing to an operator; "you are on D, you tapped at 04:45, you are on
  DT4023" is the only line on the page they can act on. Everyone else gets the
  strip too, because everyone has a shift.
- **The grid is eight cards in a fixed order** (owner, 2026-09-18): _Tidak
  lolos FTW · Belum lapor FTW · Belum absen · Hadir_, then _ACTUAL shift ini ·
  Unit terisi · Unit tidak terisi · Unit breakdown_. Two rows of four — the
  people, then the yard. A card the caller has no grant for leaves a gap
  rather than shifting the rest up: the reader is missing a card, not looking
  at a different one.
- **Unit tidak terisi is its own card.** It used to be the small print under
  _Unit terisi_, where a shortfall of 292 read as a footnote to a 0 — and the
  shortfall is the half somebody has to act on.
- **ACTUAL is about the shift, not the day** (owner, 2026-09-18), and it
  reports the clock rather than a count. It used to read `1/2` for the day's
  two boards, which answers a question nobody at a muster asks — by the time
  tonight's board matters, it is tonight's shift. A board generated at 04:10
  and one generated at 07:04 are very different mornings, and the second is
  the one somebody wants to know about. No board for this shift shows "—" and
  "belum digenerate", never a zero: not generated and generated-holding-
  nothing are different mornings too.

  The instant is sent as an ISO string and rendered through `siteClock`, which
  moved to `lib` when the dashboard became its second caller. `generated_at`
  is a `timestamptz`, and its `::text` form carries a space separator and a
  bare `+00` offset that browsers are not obliged to parse — the card would
  have printed "—" all morning with nothing anywhere saying why.

- **Three cards were taken out** (owner, 2026-09-18). _Fit shift ini_ said the
  same thing as the two beside it with the sign reversed, and the reader who
  needs to act is looking for the failures. _Display TV online_ is not about
  the shift at all. Both counts left the payload with them — `ftw.fit` and the
  whole `devices` section — because a figure no screen reads has still crossed
  the wire. Offline displays keep their rows in the attention panel: a dark TV
  in the yard is exactly the sort of thing nobody notices without being told.
  _Unit belum masuk fleet_ went the same way, and `fleetConfig` with it; the
  gap it reported is Fleet Settings' own business and that screen shows it.
- **Unmatched source readings were a second such card, and were taken out**
  (owner, 2026-09-01). A reading whose NIK matches nobody is not an error
  anywhere — it is simply skipped, by these counts, by the attendance table,
  and by the allocation engine's candidate pool. On 2026-09-01 that was 101 of
  344 FTW rows and 531 of 1155 taps, so every other figure on the page is
  quietly computed over the remainder. The finding stands and is worth chasing;
  the dashboard is simply not where it is reported.
- **The FTW section counts who _owes_ a filing, not who is on shift** (owner,
  2026-09-18). The same narrowing the fit-to-work wall has always applied, and
  now from the same definition: `ftw-obliged.ts` holds the rule once, as a
  `where` the dashboard drops into its aggregate and as the set the wall, the
  ingest list and the ticket already asked for. On 2026-09-18 the card read
  "belum lapor 84" where 10 was the answer — of the other 74, seventy-two hold
  no licence for a unit the master marks `ftw` and two sit in a position that
  is never allocated a unit at all. None of them had filed, which is not a
  failure; it is the rule working. It narrows the whole section rather than
  the missing count alone, because a denominator holding people whose filings
  were never counted makes "240 fit of 332" arithmetic nobody can reproduce.

  **Attendance is deliberately not narrowed.** Everybody rostered is expected
  at the gate, clerk or operator; a tap card borrowing this denominator would
  stop counting most of the site.

- **A filing passes on both verdicts or neither** (owner, 2026-09-18). savera
  sends two independent answers — `ftw_decision` ("FTW aman") and
  `sleep_category` ("Dapat Bekerja") — and the board, the walls and now this
  card all require both. The card used to read the decision alone, which made
  it the most optimistic number on the page: on 2026-09-18 it showed 2 people
  worth looking at where the Fit To Work menu showed 7, because six "FTW aman"
  rows carried a category of "Tidak Boleh Bekerja" or "Istirahat Minimal N
  Jam". Neither column is a summary of the other. Lateness is deliberately not
  part of this card — `judgeFtw` fails a filing sent after the deadline, but
  that is an allocation gate rather than anything about the person's fitness,
  and the card sends its reader to Fit To Work to look for a health reason.

  The attention row names the verdict that _failed_, in savera's own words.
  Sending the decision regardless printed "FTW aman" beside a name listed as
  unfit — the row arguing with itself in front of the supervisor acting on it.

  **The Fit To Work menu still tints its rows by category alone**, so a filing
  that clears the category and fails the decision reads green there and counts
  here. That is one person on 2026-09-18, and it is the menu that is short.

- **Four charts replaced the attention table** (owner, 2026-09-18). The table
  listed ten names and a badge; the verdict on it was "jelek dan tidak
  informatif", and fairly — a list of whoever sorted first never did say how
  the shift was going. In its place are the four panels the operations admin
  rebuilt by hand in a spreadsheet for every morning meeting: _Rasio
  Operator_, _Operator Spare_, _Laporan Alat_, _Istirahat_. The numbers were
  always in this database; only the assembling was manual.

  Stacked by how much width each panel needs rather than in a plain grid
  (owner, 2026-09-18): _Rasio Operator_ full width, then _Laporan Alat_ full
  width, then the two treemaps side by side. The first two carry a row per
  category and a group of three columns per unit class — both run out of room
  in half a screen, and a rotated axis label is the first thing to go. The
  treemaps are a handful of tiles each and drop to one column when the
  viewport can no longer hold two.

  **One categorisation across the three operator panels**, so a bar and a tile
  reading "DOZER" are about the same dozers. `unit_types` is nearly the report's
  own vocabulary already; the one place it is too coarse is `EXCAVATOR`, which
  holds both the production digger that leads a formation and the small
  excavator that supports one. `unit_classes` draws exactly that line, so
  excavators group by class and everything else by type. The equipment panel is
  deliberately finer — it wants the tonnage split (`REARDUMP100T` against
  `REARDUMP60T`) that the operator panels would drown in. Two questions, two
  granularities.

  **A spare belongs to the best unit their licences reach.** Over half hold
  licences across two or three categories (58 and 14 of 131 on 2026-09-18), and
  counting one person under each would draw a treemap whose tiles sum to more
  than the pool. Priority rank breaks the tie rather than an arbitrary pick,
  because it is already the order the engine would crew them in. Spares are in
  the ratio chart too, not only in their own tile: a ratio that left out 131 of
  330 people would be a ratio of something nobody asked about.

  **Names stay the register's own.** The morning report writes OHT, DT and
  DIGGER; the screen writes `REAR DUMP TRUCK`, `DUMP TRUCK` and `BIGDIGGER`,
  because every other menu spells them the way the register does and one screen
  inventing a second vocabulary is how two people come to count different
  things.

  **The charts need all three grants they are made of** — `fleet-allocation`,
  `attendance` and `fit-to-work`. A bar labelled "tidak lolos FTW" is a
  fit-to-work figure whatever panel it is drawn on, and opening it on the
  allocation grant alone would hand FTW numbers to somebody the FTW section is
  withheld from.

- **The page never loads blank** (owner, 2026-09-18). The request takes
  300–600 ms, and every card, the personal strip and the charts render only
  once their section has arrived — so for that long the page was a title over
  nothing. It now shows a skeleton of its eventual shape, predicted from the
  grants the shell already holds (the same grants the API gates each section
  on) and from whether the account carries a NIK, so an operator whose whole
  dashboard is the personal strip does not watch eight cards and four charts
  appear and vanish. The prediction only places grey blocks; the real cards
  still gate on the payload, never on it.

  Each placeholder is built at its component's own measurements — the card's
  44px icon well and 32px figure, the chart heights (shared constants, so the
  two cannot drift), the table's 40px header and 45px rows — because a
  skeleton a row short makes the page jump when the data replaces it. Only the
  first load shows it: the minute refetch keeps the previous figures on
  screen. A failed first load says so with a retry, rather than leaving a
  blank that reads as "nothing to report".

- **The chart palette is validated, not chosen by eye.** Eight categorical
  slots in a fixed order (identity, never rank — these panels re-sort every
  minute, and a palette assigned by size would repaint DOZER as one more
  operator tapped in), validated against this application's own glass surfaces
  rather than any default: worst adjacent CVD ΔE 8.4 dark / 9.1 light, normal
  vision 19.3 / 19.6. A ninth category is never a generated hue — it folds into
  `LAINNYA`, shown rather than dropped.

  The ratio bar uses the reserved status palette, and **its segment order is
  load-bearing**: status green and status red sit ΔE 4.1 apart under
  deuteranopia, so amber is always between them and they never share an edge.
  Every segment carries its own count and the table beneath repeats them, which
  is also the relief the light-mode contrast warning obliges. The equipment
  panel counts machines on one axis; the spreadsheet it replaces drew
  percentages and printed counts on the bars, which is two scales in one frame.

  The eight named categories were checked against the register, not assumed:
  the first draft carried `WHEELDIGGER` (one machine, in no formation, crewed
  by nobody) and omitted `MANHAUL TRUCK`, which would have folded five real
  operators into `LAINNYA` with nothing saying so.

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
- **Support has its own filter option on every screen that has one**: the PLAN
  board, the Actual board, and the audit table. "No fleet" was two answers in
  one — a dozer somebody has to crew, and a forklift nobody does — and on PLAN,
  which carries the whole active register, both sat in the same list. The
  option only appears where the board actually holds one.
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
  board: **every active unit** (minus `breakdown`, which needs no operator;
  `standby` units are allocated since 2026-09-15), its planned operator kept if
  they pass, and every vacancy offered
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

### The support wall — shipped

- **A reserved screen of its own** (owner, 2026-09-04), id `fleet-support`,
  created the first time anybody opens the Display menu. Support is not a pit:
  its machines are scattered across the site, so putting them in a pit screen's
  rotation would have a TV at one panel cycling through dozers working
  somewhere else. The yard always has support units, so the screen is part of
  the product rather than something to set up.
- **Plan first, then the board — the same as every formation wall** (owner,
  2026-09-18). From the changeover it shows each support unit's standing
  operator, taken from the plan and marked provisional; once `spare-validate`
  has built the board it shows who the board actually put there, spares
  included. The second half always worked, because a board gives the support
  group a snapshot row of its own. The first never did: a support unit belongs
  to no formation, so its plan slot carries no group id, and the wall dropped
  every slot without one. On 2026-09-18 the plan held 42 support units, 28 with
  an operator rostered on, and the wall showed none of them until the board.
  Plan support slots now gather under one fixed key; a slot with no id that is
  not support still drops out, as before.
- **Fixed in every respect but its dwell.** Name, layout and contents are
  decided by what it is; `rotateSeconds` is the one honest question, because
  how long a slide should hold depends on the room. Changes to the rest are
  refused with a message, not ignored — and refused on a _real_ change, so a
  form echoing values back unchanged still goes through. It cannot be deleted,
  and its id cannot be taken by a new device.
- **Six cards to a slide, one row.** Half a formation slide's widest row,
  because each of these cards carries two badges a formation card does not:
  where the unit is working, and which vehicle brings its crew. Those two are
  the whole reason somebody walks up to this screen. Fifty-nine support units
  is ten slides.
- **The unit's own work area is on the board**, not only its group's. A
  formation's members share one and the group carries it; the support group has
  none, and without a per-slot column each of its machines' whereabouts that
  shift was simply not recorded.
- The formation header drops its leader badge on this screen — the support
  group is led by none.
- **The card shows no NIK** (owner, 2026-09-04). It carries the operator's
  photograph and their name, and a number identifying somebody already looking
  out of the card was a line of height a quadrant on a monitor wall cannot
  spare. It is still fetched, because the photograph is addressed by it.
- **The bus and the two readiness verdicts share one row**, at badge size. The
  work area keeps a line of its own on the support wall: it is prose, and long
  enough that sharing a row would push the badges onto a second one anyway.
- **The bus is on every card, on both walls.** It is a fact about a unit now,
  so a group header can only ever speak for the case where a formation's units
  all ride the same one: it says the vehicle when they agree and says nothing
  when they do not, because a dash there would read as "no bus" about a fleet
  where every card names one. The work area stays off a formation's cards,
  where the header already says it once for all sixty.

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
  the screen at `shift-start`, or its **first** stage, `ftw-ingest`, where no
  `shift-start` is configured —
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
- **The two readiness badges say "not yet" or "not at all", and the clock
  decides which** (owner, 2026-09-10). Before a gate closes a missing reading
  is grey and reads _Belum FTW_ / _Belum Absen_; after it closes the same
  missing reading is red and reads _Tidak FTW_ / _Tidak Absen_.
  - One empty reading, two things worth saying. At ten past four an operator
    with no FTW row has simply not got to it, and grey is a to-do list. At six
    the same empty row is somebody who never filed one and whose unit the board
    has already handed on — and a screen still saying "Belum" describes a wait
    that ended an hour ago. Before this the wall was grey at every hour and
    never turned red at all.
  - Only the empty case moves. A refusal, a late upload, an unreadable one and
    a tap that happened are facts about the morning whenever they are read, and
    they keep the colours they had — including a late tap, which stays green.
  - **The verdicts stay free of the clock.** `judge` answers what the readings
    say and never asks the time, so one morning always describes itself the
    same way and the audit table can depend on that. Whether a gate has _shut_
    is a different question, only a screen asks it, and it is answered beside
    the verdict rather than inside it.
  - The gates are anchored to **the shift's own date**, not today's. A night
    shift outlives the calendar day it began in, so comparing bare clock times
    would call a gate that shut at 17:22 still open at 01:00 and spend four
    hours telling a finished shift it had time left.
  - The wall says "absen"; the audit table says "tap". A deliberate split — one
    is read by people standing in the yard, the other afterwards by someone
    asking a different question.
- Breakdown units do not appear: the board excludes them by design, and the
  wall shows the board. Standby units appear like any other (2026-09-15).
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

## Notifications

### What the application tells the people who run it — shipped

- **A board that fails to generate says so where the muster can see it**
  (owner, 2026-09-10). It always said so in the log, but the log is read by
  whoever has the server, which is not who runs the muster. In practice a
  failed board was discovered by noticing the wall had not changed — by which
  time the bus has gone. `spare-validate` now writes what it crewed on success
  and why it could not on failure.
- **A failure names a reason from a closed list, never the thrown error's own
  text.** That text routinely carries a connection string, and a notification
  persists and is read again later by anyone with the menu. What it costs is
  detail; what it buys is that the detail cannot leak somewhere it should not.
  The full error stays in the log beside it, where reading it already requires
  access to the server. Four reasons: no shift on the stage, no `finger-in`
  stage, no `ftw-deadline` stage, and everything else — which says where to
  look rather than what happened.
- **Everything past `buildBoard` is wrapped.** A throw there used to reach the
  tick loop as an unhandled rejection: logged by the runtime, mentioned to
  nobody, on the one stage whose silence is hardest to notice.
- **Rows store a kind and its facts, not a sentence.** Wording is the client's,
  in the language that client is set to — writing English copy into the API to
  satisfy a language toggle puts presentation in the wrong layer — and "5 menit
  lalu" is computed from the timestamp, because a stored one is a lie by the
  time the second person reads it.
- **One shared row, per-person read marks.** A board that failed is one event,
  not one message each; only having seen it belongs to an individual. A read
  mark's presence is its whole meaning — there is no `read: false` to store,
  because not having looked at something is the absence of an event.
- **Behind a menu grant: superadmin and manpower**, and the topbar bell is
  behind the same one. A bell that is permanently empty because the reader may
  not see anything reads as "nothing is happening", which is the wrong thing to
  imply.
- **Ninety days, swept on write.** Two rows a day, so this is not about volume:
  it is about a page that would otherwise bury this week's under years of
  routine success. Writes are rare and the sweep is one indexed delete, so a
  stage that existed only to run it would be more machinery than the problem.
- Not a queue. No delivery, no retry, no per-recipient state, because the only
  reader is a page somebody opens. Notifications that must _reach_ somebody who
  is not looking would be a different table.

### Deferred

- **A failed source pull does not notify yet**, and is the most wanted next
  candidate. One broken morning would write eighty-odd identical rows, so it
  needs repeat-collapsing first — one row with a count rather than a bell
  showing the same sentence seventeen times.
- **A board generated with units left uncrewed** is announced only as a count
  in the success notification. Naming the units would be actionable; it is also
  a longer message than a bell can hold.

## Scan ID Card — shipped

A card held up to a phone at the gate answers who this is and what the muster
gave them today (owner, 2026-09-20). The **QR code** carries the NIK; the screen
shows photograph, name, NIK, department, position, **Simper Code**, roster,
shift, unit, area, bus and check-in time. Anything the records do not hold
reads "-".

- **Its own menu**, `scan-id`, beside Attendance — read while asking about a
  person, not about a machine. Granted to **manpower** and **manajer**;
  superadmin holds every slug by reconciliation.
- **Scoped like every other read of the register** (owner, 2026-09-20). A
  `dept` role — manajer — resolves its own department and nobody else, and a
  card it may not see is the same 404 as a NIK nobody holds: which of the two
  it is, is not a screen's business. **Devices never reach it**: a kiosk that
  resolved any NIK would be a way to walk the register.
- **Read-only.** Scanning records nothing; it is looking, not an event.
- **The NIK is read by what the payload calls it** (owner, 2026-09-21): a
  JSON `nik`, then a link's `nik=` parameter, then the digits themselves —
  bare, or the last segment of a path — with leading zeros and printed
  prefixes stripped, the recipe every other source is matched by. Order
  matters: reading digits out of a whole link would fold a version or a port
  into the number and resolve to somebody else. A reading with no number in it
  is discarded before anybody is asked.
- **QR only.** Each extra symbology is another pass over every frame, and a
  screen that also read the 1D barcode on a parcel label would answer
  confidently about the wrong thing.
- **Unit, area and bus** come from `seatOf` — the board if it has decided, the
  standing plan while it has not — and an operator the board could have used
  but did not reads _SPARE_ with the pool's buses and where they wait, exactly
  as the slip prints it. Somebody allocation is not about holds nothing rather
  than SPARE.
- **Check-in** is the first IN tap of the running shift, read from the live
  taps, so it is right during the muster rather than a minute and a half late.
- **Decoding** is the browser's own `BarcodeDetector` where it exists (Chrome
  on Android) and a WebAssembly polyfill loaded on demand where it does not
  (Safari). Nothing is fetched until the camera is started.
- **The camera needs a secure origin**, which this installation does not have
  until the tunnel lands — see `docs/deploy.md`. The screen says so and the
  manual NIK field carries it meanwhile; that field is also what a scuffed
  card, a desk without a camera, and a QR reader that types the number use.

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

## Live capture and muster tickets — shipped, rolling out in stages

**Goal:** a person taps at a Universe booth and a ticket prints before they
step away — proof of attendance for everyone, and the unit, bus, fleet and area
for everyone who has one.

**Pain point:** the periodic pull reaches a tap in about a minute and a half on
thirty-odd machines. That is fine for a board and useless for a queue at a
printer. ShiftCorner prints within a second, but only on machines paired with a
printer (33 of the 57 active machines), only inside hard-coded windows, and it
loses every tap made while its connection is down.

### What the spike proved (2026-09-12, dev machine 192.168.1.2)

- **The session must be authenticated.** The machine answers `CMD_CONNECT` with
  `CMD_ACK_UNAUTH` (2005). `CMD_AUTH` (1102) carrying pyzk's commkey — derived
  from comm key `0` and the session id — is accepted (2000). `node-zklib` never
  checks that reply, so an unauthenticated session looks healthy and simply
  never receives an event. `zk-attendance-sdk` surfaces the error but does not
  authenticate either; the handshake is ours, about fifteen lines.
- **The device must be enabled before listening** (caobo171/node-zklib#26):
  `enableDevice()` then `getRealTimeLogs()`. With both, a tap at 18:49:41
  arrived as an event at 18:49:42.
- **Listening does not block counting.** `getInfo` from a second connection
  succeeded 5 of 5 times while a live connection was held for 150 s, so the
  periodic pull stays as the safety net.

### What running it proved (2026-09-13 and 14)

- **A scheduled window holds a booth for a muster.** Opened 04:30:51, closed
  05:59:54, one session, nothing pressed: `[listen] jendela tutup — 1 sesi
dibuka, 0 gagal, 1 ditutup`.
- **The latency is what it promised.** A tap the machine clocked at 05:02:41
  was recorded at 05:02:42.
- **Listening and pulling share a machine.** 240 `getInfo` calls ran at a
  thirty-second cadence while a live session was held, with a single
  `ECONNREFUSED` — about 0.4%, and it cost nothing: the pull only asks for a
  count and the next cycle succeeded. The live session was untouched.
- **A slip reaches paper.** ESC/POS to a printer on port 9100, accepted in 6 ms
  and printed, then the whole path again from a real tap.
- Still unproven: sixteen connections held together for ninety minutes. There
  is one development machine, so this waits for the hardware.

### Two clock mistakes, both found by the owner rather than by a test

Recorded because the same shape will happen again. `parseHexToTime` builds
`new Date(year, month, day, hour, ...)` — _local_ components — so the machine's
wall clock is what the **local** getters return. Reading it as UTC shifted every
stored tap by this process's offset, and a 21:11 tap was written down as 13:11.
Separately, the Live tab printed the received time straight from its ISO text,
putting 13:53 beside a machine clock reading 21:53 on the one screen whose job
is comparing those two numbers.

Both unit tests were green while the code was wrong, because each test
constructed its `Date` the same wrong way the code read it. A test written by
whoever wrote the code is blind in the same place; what caught these was a
person holding a wall clock against a screen.

### Device guard

- **`enableDevice` is allowed; nothing else is** (owner, 2026-09-13). It changes
  device state but deletes nothing — it returns the machine to accepting
  fingerprints. `disableDevice`, `clearAttendanceLog`, `deleteUser` and every
  clear/delete command stay undeclared and rejected by the read-only guard.

### Machines and printers

- **New machines, used by Universe only** (owner, 2026-09-13). They are not in
  `tbl_m_absen_to_finger`, so ShiftCorner never listens to them and no person
  receives two tickets for one tap.
- **Rolled out in stages, not all at once** (owner, 2026-09-14): two machines
  first, then more. Sixteen is where it is going, not where it starts — and
  since sixteen held sessions is the one thing the spike could not prove, the
  staging is also how that gets proven, a few machines at a time.
- **Printers are master data of their own** (owner, 2026-09-13): name and IP,
  with the same create/edit/deactivate treatment as the fingerprint machines.
- **A finger machine is paired with at most one printer, and a printer with at
  most one machine.** ShiftCorner's pairing table has 33 pairs and 33 distinct
  printers — none shared — so one-to-one is the shape the site already runs.
  The printer name is printed on the ticket. ESC/POS over TCP port 9100.
- **Machines carry a "Universe only" flag.** Universe cannot see which machines
  ShiftCorner listens to — that lives in ShiftCorner's own database — so the
  flag is how a machine is declared safe for live listening. The development
  machine and the sixteen new booths carry it; every production machine
  registered today does not.

### When it listens and when it prints (day shift; night is +12 h)

| Stage            | Time  | Behaviour                                          |
| ---------------- | ----- | -------------------------------------------------- |
| `finger-ingest`  | 04:30 | Listening opens on every booth                     |
| `finger-in`      | 05:25 | First finger closes; a later first tap is **late** |
| `spare-validate` | 05:26 | Allocation runs and is **final**                   |
| `finger-second`  | 05:28 | Spare tickets start printing                       |

A spare's repeat tap before 05:28 is recorded and prints nothing, even if the
allocation has already finished (owner, 2026-09-13).

### Listening outside the schedule, and the live log

- **Live listening never touches a production machine** (owner, 2026-09-13).
  Listening sends `enableDevice`, which changes device state, and production
  machines are ShiftCorner's. Scheduled and manual listening both run only on
  machines flagged "Universe only" — the development machine and the sixteen
  new booths. Production machines keep the periodic pull they have today:
  read-only, no live session.
- **Listening follows the timeline by default** (owner, 2026-09-13): it opens at
  `finger-ingest` and stays open through the gap between the two fingers until
  `bus-depart` plus the collection grace. It does not disconnect for the three
  minutes between 05:25 and 05:28 — those taps are still recorded.
- **A manual listen exists for testing** (owner, 2026-09-13). An admin picks
  machines one at a time and starts listening. Only "Universe only" machines
  can be chosen; a production machine is not offered.
- **A manual listen runs until someone presses stop** (owner, 2026-09-13). To
  keep a forgotten session visible, the screen shows every active listen with
  who started it and since when, and a server restart ends every manual
  session rather than resuming it.
- **The live log is a tab on the tap monitoring screen.** The server holds the
  connections and records each event; the tab refreshes every few seconds, the
  same polling every other monitoring screen uses. No WebSocket or SSE — the
  application has none today, and a testing log does not justify the first.
- Starting and stopping a listen needs `manage` access to the monitoring menu;
  reading the log needs `view`.

### Who gets a ticket

**Everyone who taps gets a ticket as proof of attendance.** Allocation fields —
fleet, unit, bus, area — are filled only for a person who has a unit
(owner, 2026-09-13).

| Person                                        | When          | Ticket                                |
| --------------------------------------------- | ------------- | ------------------------------------- |
| Standing operator, FTW passed, on time        | first finger  | Full                                  |
| Standing operator, FTW not yet in, on time    | first finger  | No allocation fields                  |
| Standing operator, FTW failed or late upload  | any tap       | No allocation fields; never allocated |
| Standing operator, unit on a non-FTW unit     | first finger  | Not judged on FTW                     |
| Standing operator, tapped after 05:25         | any tap       | No allocation fields; not allocated   |
| Fleet setting not filled when they tap        | any tap       | No allocation fields                  |
| Spare                                         | first finger  | **No ticket**; tap recorded           |
| Spare, allocated                              | second finger | Full; time is the **first** tap       |
| Spare, not allocated                          | second finger | No allocation fields                  |
| Spare who skipped first finger                | any tap       | No allocation fields; not allocated   |
| Standing operator whose unit is not allocated | as a spare    | As a spare: waits for second finger   |
| Employee whose status is not `aktif`          | any tap       | No allocation fields; never allocated |

- **A plan seat reaches paper only if the board is about that unit** (owner,
  2026-09-15): active, not broken down, and in a formation or crewed as
  support. Standby units qualify. An operator whose unit does not is a spare
  for the ticket, as he already is for the board — Alif Zainuddin's slip read
  DT4084 while DT4084 was broken down and in no formation.
- **An employee who is not `aktif` gets no allocation fields** from the plan or
  from a board generated before the status changed. The wall of people owing
  FTW leaves them out too. The slip carries no operator kind at all since the
  format change of 2026-09-15.

- **FTW passes only on `FTW aman` and `Dapat Bekerja` together** (≥ 330 minutes
  of sleep, the category savera assigns), uploaded before `ftw-deadline`. This
  is the rule `readiness.ts` already enforces; unchanged.
- **The attendance time is always the person's first tap of the shift.** That is
  why a spare taps twice.

### What the slip says

The owner's format of 2026-09-15, on a 32-column roll:

```
PT UNGGUL DINAMIKA UTAMA            (centred, bold)
SITE PROJECT INDEXIM                (centred, bold)
--------------------------------
NIK            : 501241775
NAMA           : Ruben Lottong
JABATAN        : Operator OHT
DEPARTEMEN     : MINING OPERATION
UNIT           : DT4027
NO BUS         : RBU26
FLEET          : EX4012
AREA           : PANEL EAST - UTARA BAWAH
NAMA PRINTER   : MESIN 31 KM 31
JAM ABSEN      : 2026-09-15 17:12:04
STATUS         : IN
FTW            : Dapat Bekerja      (bold)
--------------------------------
LOKASI BERBAHAYA                    (bold)
KASTURI BAWAH, KASTURI ATAS
--------------------------------
BAHAYA FATIGUE MENULAR              (centred)
SESUAI APLIKASI                     (centred)
--------------------------------
```

- **No title, no operator kind, no thank-you lines.** BUKTI ABSEN MASUK,
  JENIS OPERATOR and the three closing sentences were removed. The kind is
  still stored with the slip, for the Tiket menu's filter.
- **FTW sits in the field column, bold.** A category too long for the roll
  ("Istirahat Minimal 1 Jam") breaks at a word and hangs under the value.
  Nothing uploaded reads "Belum Upload".
- **UNIT reads SPARE for an operator who got no unit** (owner, 2026-09-15),
  standing or spare, whatever the reason: FTW not yet uploaded, failed or
  rest, a late upload or tap, no vacancy, no matching SIMPER. The FTW line
  says which. An operator here is an `aktif` employee in a position that is
  allocated. Everybody else — a standby employee, a mechanic who tapped —
  reads `-`, as does a slip stored before the rule. NO BUS, FLEET and AREA
  stay `-` either way.
- **There is no late tolerance** (owner, 2026-09-15). A tap after the
  finger-in deadline or an upload after the FTW deadline is not allocated by
  the board; an admin places the person by hand.
- **Somebody the board never considers prints at once** (2026-09-15) — a
  mechanic, a standby employee, anybody not `aktif` in an allocated
  position. The full-scenario print test found them held to the second
  finger, waiting for an allocation that is never made for them.
- **A SPARE slip names the spare bus** (owner, 2026-09-15). Fleet Setting
  carries the spare pool's ride as rows of their own — `SPARE | PARKIRAN
KASTURI | SPARE | RBU26`: unit and fleet cells read SPARE, the area is
  where the spare buses wait, the bus must be a transport unit. At most two
  rows, one area between them; a file writing more, or a second area, is
  refused. Every import replaces the last one's rows, since the yard swaps
  the buses between shifts. The board copies them when it is built, so an
  import for the next shift changes nothing for the one under way. The slip
  prints `NO BUS : RBU26/RBU27`, `FLEET : -` and the area on every UNIT
  SPARE; a seat prints its own ride, and `UNIT : -` rides nothing.
- **Fleet Spare is a built-in wall and a pinned entry, like Fleet Support**
  (owner, 2026-09-15). The Display menu always carries a `fleet-spare` screen
  — created on its own, fixed in all but its dwell, never deleted — showing
  one group of spares, each with photo, tap and FTW badge, under the spare
  area and buses. No other screen shows the spare pool. Fleet Setting pins a
  read-only "Fleet spare" row with the area and buses the last import set.
- **Who is on it: the shift's operators whom no other wall shows on a unit**
  (owner, 2026-09-18). From the changeover, the whole spare pool, tapped or
  not; once `spare-validate` has built the board, only the spares it left
  without a unit — the ones it seated are on their own fleet's wall. One rule
  covers both: everybody the roster puts on the shift (`aktif`, in an
  allocatable position, the document in force) less everybody on a unit of
  the line-up the walls are showing, which is the plan before the board and
  the board after. Every operator therefore stands on exactly one screen — a
  formation's, the support wall, or this one; on 2026-09-18 day that was 179
  on plan units and 151 here, the 330 on the roster. A standing operator
  whose unit is broken down, outside allocation or held by a shift partner
  today lands here too, which is also where the engine looks for them.

  It replaced reading the slips (2026-09-15), which showed only people who
  had already tapped and been handed paper saying SPARE: the wall stood empty
  at the changeover, when arriving spares most want to see where they stand,
  and after the board it said nothing about every spare who never tapped,
  though they are exactly as unallocated. Tapped spares lead, in tap order —
  the order a vacancy is offered in — then the rest by name, their finger
  badge reading "Belum Absen" and, past the gate, "Tidak Absen".

- **The slip reads taps and seats the way the board does** (2026-09-15):
  - **Every board is built from freshly derived readings.** `spare-validate`
    and the Actual tab's regenerate rebuild `finger_readings` from every tap
    first, and a tap heard live triggers a rebuild within seconds. Readings
    used to be rebuilt only when a pull stored something new, so a tap heard
    live just before the gate — or a whole morning with the pull down — was on
    the slip and missing from the board.
  - **An OUT the pull recorded is not an arrival** on the slip either, as it
    is not in the reading; a live-only tap still counts as one.
  - **A board seat prints as the board has it**, the engine's and an admin's
    alike. The board judged when it was built; judging again at the booth
    could only disagree with the wall. Only a plan seat, before any board, is
    judged at the booth.
  - **A regenerated board keeps a spare on the vacancy his slip names**, if
    he is still ready and eligible, before refilling by tap order.
- **A seat an admin placed by hand always prints** (owner, 2026-09-15),
  whatever readiness says — even over a failed FTW. A hand placement is how a
  late person reaches a unit at all; judging it again printed SPARE while the
  wall showed him on the unit.
- **A plan seat needs the roster** (2026-09-15). An operator not rostered to
  the shift prints SPARE before the board as after it, since the board never
  considers him; and nothing holds his slip for the second finger.
- **Once the board exists, only the board seats anybody** (2026-09-15).
  Somebody it did not seat prints SPARE, whatever his plan says; the print
  test found a tap heard too late for the board printing a standing unit the
  board had already given to a spare holding a slip for it. An admin places
  him by hand.
- **A spare certain to get no unit prints at once** (owner, 2026-09-15): his
  FTW, judged as if the unit asked for it, is already a final no — Tidak Boleh
  Bekerja, Istirahat, uploaded late, or not uploaded once the FTW deadline has
  passed — and every unit in allocation that he holds a SIMPER for asks for
  FTW. The board seats a spare with a failed FTW on a unit that asks none, so
  while such a unit is within his SIMPERs his slip still waits for the second
  finger, as does a spare whose FTW may still arrive or pass.
- **A spare whose first finger is late prints at once** (2026-09-15). The
  board will not seat him, so waiting for the second finger only made him tap
  twice for the same SPARE.
- **A plan seat on a slip printed before the board asks what the board will
  ask** (2026-09-15): the unit's SIMPER held and in date, the department
  matching (`pairingRefusal`), and — when a partner on the same unit is
  rostered to the same shift — the board's own order: ready and eligible
  first, then **whoever already holds a slip naming the unit**, then the
  earlier tap, then NIK. A refusal prints SPARE. The slip rule is the owner's
  (2026-09-15): a partner who tapped first but was ready only later (his FTW
  arrived after) does not take a unit already handed to the other on paper,
  on the slip or on the board. A failed print counts as handed.
- **FTW reads `-` for somebody who owes no filing** and has none: the
  fit-to-work wall's own test (aktif, allocated position, a SIMPER on a unit
  that asks for FTW). An upload is printed whoever made it. An upload that
  arrived late still prints its category; the UNIT line says SPARE.
- **The provisional fleet wall shows `aktif` employees only**, as the board
  and the slip do.
- **Safety messages close the slip, centred, at most two**, each wrapped on its
  own. The wall still shows every active one. Locations stay capped at eight.
- A section with nothing set prints neither its heading nor its rule.
- A reprint renders the stored fields in the current format.

### Filling in a unit later

- Allocation is final. A late person reaches a unit only through a **manual
  placement by an admin**, which the Actual tab already allows.
- After a manual placement, or after the fleet setting is filled, the person
  **taps again** and a full ticket prints. Tickets never print on their own.
- **A repeat tap prints only when the ticket's contents changed** — a unit that
  is now filled, say. The same contents print nothing (owner, 2026-09-13).

### Manual placement of someone who failed FTW

- **Allowed, with a warning, and recorded** (owner, 2026-09-13) — shipped.
  Every manual placement writes a row to `fleet_placements`: the unit, the
  person or the vacancy, who made it and when, and both verdicts as they read
  at that moment rather than as they read later. The name is copied rather than
  joined, so a deleted account still answers "who".
- **The two kinds of override are not alike.** Lateness a supervisor decides on
  their own judgement; a failed or missing FTW on a unit that asks for one is
  refused by the server until it is confirmed, and the screen asks in those
  words before sending the confirmation. The verdict is judged again at the
  moment of the placement rather than trusted from the screen.

### Ticket contents and where each field comes from

- **Two sources, by when the ticket prints.** A standing operator's
  first-finger ticket prints before the board exists, so it reads the
  **standing plan**: the unit held in `fleet_plan_slots`, with bus, fleet and
  area from that unit and the fleet setting. Every later ticket — spares at the
  second finger, anyone after a manual placement — reads the **generated
  board** (`fleet_actual_slots`).
- **The plan is printed as it stands** (owner, 2026-09-13). Making unit status
  final — breakdown, standby, who holds what — is the admin's job when the
  fleet setting is imported at shift start (04:00). The ticket does not second-
  guess it.

The fields below are the generated board's; a first-finger ticket takes the
same fields from the plan.

| Field                | Source                                                     |
| -------------------- | ---------------------------------------------------------- |
| NIK, name            | `employees`                                                |
| Position, department | `positions.name`, `departments.name`                       |
| Unit                 | `units.code` of the seated slot                            |
| Bus                  | `fleet_actual_slots.transport_code`                        |
| Fleet                | `fleet_actual_fleets.leader_code`; support units have none |
| Area                 | `fleet_actual_slots.work_area`                             |
| Printer name         | the booth's paired printer                                 |
| Attendance time      | first tap of the shift                                     |
| Status               | IN                                                         |

### The attendance wall shows the scan as a ticket — shipped

The attendance TV stopped being a list of who has not arrived (owner,
2026-09-19). It now shows **the person who just scanned**, as one large card:
photograph, name, NIK, **Status IN**, the clock-in time to the second, the
**FTW category**, the **shift**, and the **unit, area and bus** their slip
printed. It states facts and **judges none** — no Hadir / Terlambat: whether
a tap was on time is the Attendance menu's question, not the booth's. A value
the records do not hold reads "-". The TV's device-name chip is not shown here.
Every word on it is Indonesian (owner, 2026-09-19): the screen is titled
**Display Absensi** with the shift in the line beneath, and the machine's
IN / OUT reads **Masuk / Keluar**. FTW is coloured as the Fit to Work page
colours its badge — Dapat Bekerja green, Istirahat yellow, Tidak Boleh Bekerja
red, no filing an uncoloured dash — and a SPARE unit is yellow.
The card is design option A, "Split Signal" (owner, 2026-09-19): a cyan
identity panel with the photograph on the left; name, NIK and status pill,
then the check-in time, then a grid of FTW (two columns), unit, shift, area
and bus on the right.

- **Both sources, merged.** Live-session taps (about 1 s) and pulled taps
  (about 90 s, every booth machine) for the running shift — from its
  `shift-start` gate, the same boundary every wall turns on. A tap both saw is
  one ticket, keyed on machine + NIK + machine time, and placed at whichever
  moment we first learned of it.
- **Anyone in the register**, rostered or not. Taps by NIKs we do not carry
  are dropped.
- **Status** is IN, or OUT when a pulled tap recorded that direction; a live
  tap carries none and reads IN, as the slip does.
- **FTW** is savera's sleep category from `ftw_readings` for the shift's date,
  as the fleet wall reads it.
- **Unit, area and bus** are what the slip printed — the seat, or _SPARE_ with
  the spare pool's buses and where they wait, or a dash — found by the rule the
  listener files slips under (the tap's own date and half of the day). No slip,
  and all three read "-".
- **The queue.** The screen polls every 2 s and takes new scans in the order
  they reached us. Each ticket holds the screen for **3 s**; with nobody
  waiting, **the last ticket stays up**. Opening the screen shows only the
  latest scan rather than replaying the shift. A person already on the glass or
  in line is not queued again, so a double press is one ticket.
- **A rush gives way** (owner, 2026-09-19). At most **20** tickets wait — a
  minute behind. Past that the oldest are skipped and the card says
  _+N lainnya_, so the screen never looks as if it showed everyone when it did
  not.
- **Photos** come from `GET /v1/attendance/display/photo/:nik`, which serves
  only people who scanned during the running shift — the fleet wall's rule,
  drawn around this wall — so a paired TV cannot walk the register.
- The previous endpoint, `GET /v1/attendance/display`, is **kept until the new
  screen has run a muster**, as the way back; nothing calls it now.

### When the printer fails

- The tap is recorded as attendance regardless.
- The ticket is retried for about 60 s, then marked for a manual reprint on the
  monitoring screen. Nothing prints unattended after the person has left
  (owner, 2026-09-13).

### Open questions

- **Nakula is no longer read** (owner, 2026-09-14). `derive.ts` writes
  `finger_readings` directly, the finger-ingest stage only listens, and the
  manual Sync button rebuilds from the taps we hold. The comparison tab and the
  shadow table went with the parallel run they belonged to.
- **Coverage is the thing to watch now, and it is thin.** 330–355 operators tap
  each day across 25–29 machines; Universe listens to two or three. Everyone who
  taps somewhere else has no attendance in this system, so the board will seat
  only the people who reached a Universe booth. That is acceptable while the
  trial runs on a laptop and production still runs the previous branch against
  Nakula — and it is the reason the machine rollout, not the code, is what
  decides when this can be deployed.
- **The "Tap mentah" tab stays until the machine rollout is done** (owner,
  2026-09-14). The Live tab shows only what lands while a listen session is
  open: no in/out direction, no three-day history, no export. While Universe
  hears two machines of sixteen, raw taps are the only place a tap outside the
  scheduled window is visible. When the fleet is fully paired, the tab goes and
  the Excel export moves to Attendance. `device_taps` itself stays either way —
  `derive.ts` reads it to build `finger_readings`.
