<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Frontend — shadcn-style components over a typed API

Vendored design system (owned code, no Radix — every primitive hand-rolled),
data via Eden Treaty + TanStack React Query, RBAC-driven shell. Layers flow
downward only: routes `app/(app)/{menu}/page.tsx` (thin wrappers) → menu
components (`components/menus/*`, registered in `registry.tsx`) → shell →
design system (`components/ui/*`) → `lib/*`.

## Reference docs — read before working (local `docs/`, gitignored)

| Doc                    | Read it when                                                  |
| ---------------------- | ------------------------------------------------------------- |
| `docs/architecture.md` | Adding a menu/page, touching routing, auth flow, or data flow |
| `docs/schema.md`       | Consuming API data — where every type must come from          |
| `docs/rules.md`        | Writing any component or query — the full mandatory list      |
| `docs/design.md`       | Any UI work — the 24 components, tokens, compound patterns    |

If `docs/` is absent on this machine, fall back to the root `README.md` and
the code itself.

## The sharpest rules (the full list is in `docs/rules.md`)

1. **Check before you create.** Read `components/ui/` first; extend an
   existing component with a cva variant or prop. A new component is only
   justified when nothing in the existing 24 covers the role.
2. **No hardcoded colors — tokens only** (`text-(--text-primary)`,
   `bg-(--fill-subtle)`, …). Missing color = add a token to `globals.css`,
   both dark and light blocks. Sole exception: the cyan brand-glow
   `rgba(0,212,255,…)` literals.
3. **`parseDate: false` stays on every Eden client**, binary downloads go
   through `fetchBlob` (never Eden), queries live in `lib/queries/{domain}.ts`
   with `unwrap`.
4. **No hardcoded user-facing strings** — `useI18n()`, and every new string
   goes into both `lib/i18n/id.ts` and `en.ts`.
5. **`proxy.ts` is a cookie-presence check, not the security boundary.** Do
   not add authorization there; the API macro is the boundary.

## Verification

No test suite here: `bun run typecheck` + `bun run lint`, then the running
app. Never `next build` while the dev server runs — it corrupts `.next` and
every route 500s.
