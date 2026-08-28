# Web rules (mandatory)

The full list. The sharpest ones are repeated in `AGENTS.md`.

## Components

1. **Check before you create.** Read `components/ui/` first. If a component
   with a similar role exists, extend it with a **variant** (cva variant or
   prop) — a new component is only justified when nothing in the existing 24
   covers the role even with a new variant.
2. **Match the existing architecture.** Compound sub-components in one file,
   single named-export statement at the bottom, `cn()` for every className
   merge, cva for visual variants, props typed inline, `"use client"` only
   when state/effects are needed. Page-specific pieces live next to their
   menu component, not in `ui/`.
3. **`components/ui/` stays backend-agnostic.** Never import from `menus/`,
   `lib/queries`, `lib/access`, or data modules there.
4. **No Radix, no headless UI libraries.** Every primitive is hand-rolled;
   extend what exists.

## Styling

5. **No hardcoded colors — tokens only.** Every color is a CSS variable from
   `app/globals.css`, consumed as `text-(--text-primary)`,
   `bg-(--fill-subtle)`, `border-(--divider)`, badge tokens, etc. Arbitrary
   hex in className is an ESLint error. A missing color means **adding a token
   to `globals.css` (both dark and light blocks)** — never inlining it. Sole
   exception: the cyan brand-glow `rgba(0,212,255,…)` literals; reuse those
   exact values, introduce no other literal color.
6. **Radius/spacing come from the token scale** (`--radius-card`,
   `--radius-chip`, `--radius-control`, `--radius-icon`) — tailwind-merge is
   taught this scale, so use the token classes, not arbitrary values.

## Data

7. **All JSON traffic goes through the Eden clients in `lib/api.ts`** —
   `api` in the browser, `serverApi()` in Server Components. Never raw
   `fetch` for JSON.
8. **`parseDate: false` stays on every Eden client.** Otherwise runtime
   `Date` objects hide behind `string` types and React throws on render.
9. **Binary responses go through `fetchBlob`, never Eden.** Treaty
   text-decodes unknown bodies and corrupts spreadsheets/images irreversibly.
10. **Queries/mutations live in `lib/queries/{domain}.ts`** with `unwrap`, so
    thrown Eden errors keep their status (`isStatus`, `errorCode`,
    `errorMessage`). Reuse the module's query keys for invalidation.
11. **No new `lib/*-data.ts` sample modules.** New features fetch from the
    API.

## Access & auth

12. **Never hardcode per-role UI.** Visibility comes from `RoleProvider`'s
    effective permissions; the sidebar/topbar filter through it.
13. **No authorization logic in `proxy.ts`** — cookie presence only. The API
    macro is the boundary. It admits `/display/*` on either the device cookie
    or a session; everything else needs a session.
14. **Never redirect to a `?next=` without proving it is ours** (`safeNext` in
    `login-form.tsx`). A leading slash is not proof: `//evil.com` has one and
    browsers treat it as protocol-relative, so it leaves the site — right after
    the person typed their password.

## Text

15. **No hardcoded user-facing strings.** `const { t } = useI18n()` and read
    from the typed dict. Every new string goes into **both** `lib/i18n/id.ts`
    and `en.ts`; `Dict` derives from `id.ts`, so a missing English entry
    fails typecheck.

## Verification

16. No test suite here: `bun run typecheck` + `bun run lint`, then the
    running app. Never `next build` while the dev server runs (corrupts
    `.next`).
