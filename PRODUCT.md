# Product

<!-- impeccable:product-schema 1 -->

This file is the design-facing summary. It points to the records that hold the
detail and does not restate their rules. When it disagrees with them, they win:

- `README.md`: what UNIVERSE does, the allocation model, roles and the
  non-negotiables.
- `docs/domain-map.md`: the glossary, the timeline gates, the rules that must
  not break, and where each one lives in code.
- `docs/prd.md`: the requirement record for each feature area, which settles
  any disagreement.
- `apps/web/docs/design.md` and `apps/web/AGENTS.md`: the vendored component
  system and the token rules.

## Platform

web

## Users

Two groups use the product, and both are working against the same shift clock
(see the timeline in `docs/domain-map.md`):

- **People who run the muster.** Superadmin, Admin, Manajer, Manpower, Medic
  and User accounts work in the web console. Their scopes and menus are set by
  the role matrix in `README.md` → _Roles_. Their hardest hour is the window
  around shift start, when the board is built and gaps get filled by hand.
- **Operators at the muster point.** They read the paired TV walls
  (`/display/*`) and the printed slips to find their unit, bus and area. They
  read from a distance, standing, often before dawn or at night, and they do
  not interact with anything.

**When the two conflict, the walls win.** A wall that is hard to read leaves an
operator without a unit. The console can ask staff for more effort; a wall
cannot ask operators for anything.

## Product Purpose

Put a qualified, fit operator on every unit the moment a shift starts, filling
gaps from the spare pool. The goal is zero unit downtime at shift start. See
`README.md` → _What UNIVERSE does_ and `docs/prd.md` → _Asset & Fleet_.

## Positioning

Allocation is automatic, deterministic and bound to a schedule. The board is
built from the roster, Fit To Work and fingerprint gates on a timeline that is
stored as data. Every placement follows rules that can be checked, and staff
handle exceptions instead of assembling the board by hand. The mechanism is
described in `docs/domain-map.md` → _Allocation_.

## Operating Context

- The timeline, walls, slips, booths and printers are defined in
  `docs/domain-map.md` (_The timeline drives everything_, _Displays_,
  _Tickets_).
- External sources (savera for FTW, fingerprint machines) are read-only inputs
  (`docs/prd.md` → _FTW + attendance ingestion_, _Live capture and muster
  tickets_).
- Scale and speed limits are in `README.md` → _Scalable, secure, fast_:
  roughly 1,000 units and 2,000 employees, with a result needed within seconds.
- `/ops` is a monitoring page behind a password (`docs/prd.md` → _Operations
  Center_).

## Capabilities and Constraints

- What is wired and what is still a static design port: see the status note in
  `README.md` → _Roles_ (the quoted block) and the `— shipped` markers in
  `docs/prd.md`.
- The data is workforce PII. Scope is enforced by the API, and the UI is not
  the access boundary (`README.md` → _Roles_).
- An empty answer is never a blank screen. A wall states why it has nothing to
  show (`docs/domain-map.md` → _Displays_).
- Sample data is never shown as if it were real (`README.md` → _Getting
  started_).
- Open product decisions: the deployment target and TLS, and the mobile client
  (`README.md` → _Not done yet_); the ticket questions in `docs/prd.md` →
  _Open questions_.

## Brand Commitments

- **UNIVERSE is the product's own brand.** No client or company identity is
  required. The logo is `apps/web/public/logoV1.svg`, and the cyan brand glow
  is the one literal color the token rules allow (`apps/web/docs/design.md`).
- **Bahasa Indonesia is the primary language** (`<html lang="id">`, with
  `lib/i18n/id.ts`). English (`en.ts`) is secondary. Domain terms such as
  Kosong, Line-up sementara, FTW aman and SIMPER are kept as the site uses
  them.

## Evidence on Hand

- A real yard file has been seen: 318 machines in the first Fleet Setting
  import (`docs/prd.md` → _Fleet setting import_).
- The sample workforce and fleet come from the seed (`README.md` → _Getting
  started_) and are labeled as samples. There are no testimonials, customer
  names or performance figures, and none should be made up.

## Product Principles

1. **Readable at a glance, from a distance, in the dark.** Walls and slips
   come before the console.
2. **The clock is the product.** Every surface knows where the current shift
   stands on the timeline and says so.
3. **State the truth, including bad news.** Idle units, failed gates and
   missing data stay visible and are named, never hidden or summarized away.
4. **Rules, not judgment calls.** The UI shows why a placement or a refusal
   happened, using the reasons the engine gives.
5. **Exceptions are deliberate.** Manual overrides need explicit confirmation
   and leave a trace.

## Accessibility & Inclusion

- Walls must be readable from across a muster area by people standing in low
  light. Size and contrast come before density, and status is never shown by
  color alone (the "Belum…" and "Tidak…" badges carry words).
- The console is used under time pressure on shared terminals. Clear focus
  states, keyboard reach and plain Bahasa Indonesia labels matter more than
  ornament.
