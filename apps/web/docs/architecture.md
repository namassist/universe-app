# Web architecture

Next.js (App Router) over the Elysia API. Data via Eden Treaty + TanStack
React Query. Vendored shadcn-style design system (see `design.md`).

## Layers (dependency flows downward only)

| Layer         | Path                        | Role                                                                                                 |
| ------------- | --------------------------- | ---------------------------------------------------------------------------------------------------- |
| Routes        | `app/(app)/{menu}/page.tsx` | Thin wrappers: set `metadata`, render a menu component. Never put logic here.                        |
| Pages         | `components/menus/*`        | One component per menu/sub-page; owns local state, fetches through `lib/queries`.                    |
| Shell         | `components/layout/*`       | Sidebar, topbar, role shell — visibility from `RoleProvider` permissions.                            |
| Auth pages    | `components/auth/*`         | Login and change-password forms.                                                                     |
| Design system | `components/ui/*`           | 24 vendored compound components. Backend/data-agnostic.                                              |
| Contexts      | `components/providers/*`    | Theme, role/permissions, React Query, i18n, toast. No data stores.                                   |
| Data & rules  | `lib/*`                     | `api.ts`, `queries/*`, `access.ts` (re-export from contracts), `nav.ts`, `i18n/`, `query-client.ts`. |

New menu = slug + label in `@universe/contracts` + component in
`components/menus/` + registration in `components/menus/registry.tsx` + thin
`page.tsx` under `app/(app)/` + **a leaf in `lib/nav.ts`**. The nav leaf is not
cosmetic: `lib/um-data.ts` builds the Roles permission matrix from `NAV`, not
from `MENU_SLUGS`, so a menu missing there cannot be granted to any role
through the Roles screen. Typecheck will not catch it — everything else keyed
by `MenuSlug` is either `Partial<>` or derived at runtime.

## Routing & auth (three layers, one boundary)

1. `proxy.ts` — cookie **presence** check only. Redirects anonymous requests
   to `/login`. UX, not security; do not add authorization here (it runs on
   every request and must not touch the database).
2. `app/(app)/layout.tsx` — server-side session re-check for the shell. Kiosk
   pages sit outside this layout, so for them layer 3 is the only re-check.
3. **The API auth macro** — the actual boundary; every route re-authorizes.
   A caller who defeats 1–2 reaches a shell with no data.

Kiosk pages under `/display/*` accept **either** the device cookie
(`universe_device`) or a user session, because a kiosk has two legitimate
viewers: a wall-mounted TV that logs in as nobody and carries only what a
pairing link minted, and a person checking the same wall from their desk.
Admitting the device cookie alone sent every human visit to a login page that
could not help — signing in produced a session, and a session was exactly what
the check refused. A person still needs the menu's `view` grant from the API;
a device is still refused on writes and on any route not marked `allowDevice`.

**The API resolves the user session before the device session**
(`auth/macro.ts`), so signing a low-privileged account into a paired TV's own
browser darkens that screen: the session wins, fails the grant check, and the
device cookie beside it is never consulted. Pair TVs and leave them logged out.

The device cookie is set by the API and read by the web app. Cookies ignore
ports, so a dev cookie set on :3001 is sent to the web app on :3000; a
**split-origin deployment breaks that** and needs the `sameSite`/`secure` pair
changed together.

Note also that the shell's own `display-attendance`/`display-fleet` menus
share the `/display` prefix without the trailing slash — the proxy
distinguishes them deliberately.

**Finding this file:** Next 16 renamed `middleware.ts` to `proxy.ts`. Grepping
for a middleware file finds nothing and the redirect looks like it comes from
nowhere.

## Data flow

- Eden Treaty clients in `lib/api.ts`: `api` (browser) and `serverApi()`
  (Server Components, forwards cookies). Typed by `App` from `@universe/api`
  — type-only import, no server code in the bundle, no codegen.
- React Query definitions per domain in `lib/queries/{domain}.ts`
  (`query-client.ts` holds defaults). Menus call these, never raw fetch.
- Binary downloads go through `fetchBlob` (see `rules.md` for why).
- Legacy: a few `lib/*-data.ts` sample modules feed menus the API does not
  serve yet (notifications, parts of display). They shrink over time; never
  add one. The fit-to-work menu, its history sub-page, and the attendance
  menu read the readiness snapshots via `lib/queries/readiness.ts` —
  date-range queries plus a manage-mode manual sync, with `lastSyncedAt`
  shown as the page's freshness stamp.

## i18n

`I18nProvider` + `useI18n()` → typed dict `t`. Dictionaries in
`lib/i18n/id.ts` (source of the `Dict` type) and `en.ts`. Default language
Indonesian, persisted in localStorage.

## Related docs

- `schema.md` — the data shapes web consumes and where they come from
- `rules.md` — mandatory conventions (read before writing components)
- `design.md` — the design system itself
