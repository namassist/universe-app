<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

<!-- END:nextjs-agent-rules -->

# Frontend architecture — shadcn-style compound components

This app follows the **shadcn philosophy**: the design system is **vendored
into the repo** (owned code, not an npm library), composed of **compound
components**, styled through **design tokens**, with variants via **cva** and
class merging via **`cn()`** (`lib/utils.ts` = clsx + tailwind-merge). The one
deliberate difference from stock shadcn: there are **no Radix primitives** —
every component is hand-rolled. Do not add Radix (or any headless UI library);
extend the existing components instead.

## Layers (dependency flows downward only)

| Layer         | Path                         | Role                                                                                                                    |
| ------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Routes        | `app/{role}/{menu}/page.tsx` | Thin wrappers only — set `metadata`, render a menu component with its access `mode`. Never put logic here.              |
| Pages         | `components/menus/*`         | One component per menu/sub-page. Owns its sample data + local state. Registered in `components/menus/registry.tsx`.     |
| Shell         | `components/layout/*`        | Sidebar, topbar, role shell. Filtered by `lib/access.ts` — never hardcode per-role UI here.                             |
| Design system | `components/ui/*`            | 24 vendored compound components. **Backend/data-agnostic — never import from `menus/`, `lib/access`, or data modules.** |
| Contexts      | `components/providers/*`     | Theme, i18n, toast, role. No data stores.                                                                               |
| Data & rules  | `lib/*`                      | `access.ts` (role matrix — single source of truth), `nav.ts`, static sample data modules, `i18n/`.                      |

Compound examples already in the system — follow this shape:
`Dialog/DialogIcon/DialogTitle/DialogBody/DialogActions`,
`Panel/Toolbar/ToolbarTitle/ToolbarGroup/PanelFoot/SectionTitle/PageTitle`,
`Table/TableHeader/TableHead/TableBody/TableRow/TableCell/NameCell/IOCell`,
`Drawer/DrawerClose/Timeline/TimelineItem`,
`DropMenuWrap/DropMenu/DropMenuItem/DropMenuRadio/DropMenuHeading`.

## Component rules (mandatory)

1. **Check before you create.** Before writing ANY new component, read
   `components/ui/` first. If a component with a similar role exists, you MUST
   NOT create a duplicate — extend the existing one with a **variant** (a cva
   variant like `button.tsx`/`badge.tsx`, or a prop) instead. A new component
   is only justified when nothing in the 24 existing ones covers the role even
   with a new variant.
2. **New components must match the existing architecture.** Compound
   sub-components in one file with a single named-export statement at the
   bottom, `cn()` for every className merge, cva when the component has visual
   variants, props typed inline, `"use client"` only when state/effects are
   needed. Place it in the correct layer (see table) — page-specific pieces
   live next to their menu component, not in `ui/`.
3. **No hardcoded colors — tokens only.** Every color comes from a CSS
   variable defined in `app/globals.css`, consumed as `text-(--text-primary)`,
   `bg-(--fill-subtle)`, `border-(--divider)`, badge tokens, etc. Arbitrary
   hex in className (`bg-[#fff]`) is already an ESLint error. If a color you
   need does not exist, **add a token to `globals.css` (both dark and light
   blocks)** — never inline it. Sole inherited exception: the cyan brand-glow
   `rgba(0,212,255,…)` literals ported from the reference; reuse those exact
   values when matching that accent, and never introduce any other literal
   color.
4. **Access is data, not code.** Menu visibility and read-only vs read-write
   come from `lib/access.ts` (`ROLE_ACCESS`) via `useRole()`/`mode` — never
   branch on a role name inside a component, and always gate write affordances
   on `mode === "manage"`.
5. **Static-only data.** No fetch, no API clients, no server state. Sample
   data lives inline in the menu component or in a `lib/*-data.ts` module when
   shared across pages; mutations act on local state or show a toast. Copy in
   sidebar/pages goes through `useI18n()` (`t.*`), not string literals.
