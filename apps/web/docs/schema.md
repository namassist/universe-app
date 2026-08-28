# Web data schema — what this app consumes

Web owns no schema of its own. Every shape comes from one of three places;
when adding a type, put it in the right one.

## 1. `@universe/contracts` — the shared vocabulary

Runtime-light values and types shared by db, API, and clients (browser-safe,
no server code — see `packages/contracts/AGENTS.md`):

- `access.ts` — `MENU_SLUGS`, `MENU_LABELS`, `ACCESS_MODES` (`view`/`manage`),
  `SCOPES` (`all`/`dept`/`self`), `EffectivePermissions`. This is the access
  vocabulary; the actual role matrix is database rows.
- `session.ts` — session/user shapes returned by auth endpoints, plus the
  per-kind kiosk maps `DISPLAY_ROUTE_OF_KIND` and `DEVICE_ID_PREFIX` (shared
  with the API so neither side keeps its own copy).
- `master.ts`, `master-import.ts` — master-data shapes and the spreadsheet
  import column contracts.
- `roster.ts` — roster codes, upload/validation/revision shapes.
- `account-import.ts` — user-import contracts.
- `ApiError` — `{ code, message }`, the shape of every non-2xx body.

`lib/access.ts` re-exports the access vocabulary so old imports keep
resolving — new code may import from `@universe/contracts` directly.

## 2. Eden — inferred API types

Request/response types are inferred from `App` (`@universe/api`) through the
Treaty clients in `lib/api.ts`. There is no generated client and no local
copy of response types: rename a field in an Elysia route and this app fails
typecheck. Do not re-declare API response types by hand — infer or import.

`parseDate: false` on every client keeps those inferred types **true** at
runtime (the API declares dates as `t.String()`; Eden's reviver would smuggle
`Date` objects in behind the types).

## 3. `lib/queries/*` — the query layer

One module per domain (employees, master, roster, units, users, session,
devices, display, sounds, run-texts, bus-schedules, roles, timeline,
fingerprint-machines). Each
wraps Eden calls with `unwrap` into React Query `queryOptions`/mutations.
Query keys live here too — reuse them for invalidation, never inline a key
string in a component.

## Legacy sample data (shrinking — do not extend)

`lib/display-data.ts`, `lib/roster-data.ts`, `lib/um-data.ts`,
`lib/notifications-data.ts` feed menus whose API does not exist yet. When an
API lands, the menu moves to `lib/queries/` and the module dies.
