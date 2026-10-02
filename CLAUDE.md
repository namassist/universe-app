# universe-app — agent workflow

UNIVERSE is fleet automation for a mining company: a qualified, fit operator on
every unit the moment a shift starts. Read `README.md` for the domain model and
"Conventions worth keeping"; per-app rules live in `apps/api/AGENTS.md` (Elysia
on Bun) and `apps/web/AGENTS.md` (Next.js, vendored compound components).

**Before touching allocation, the walls (`/display/*`) or tickets, read
`docs/domain-map.md`.** It has the glossary, the timeline gates, the rules
that must not break, and where each lives in code, tests and `docs/prd.md`.

The workflow is **ECC** — a curated subset under `.claude/` (see
`.claude/ECC.md`). Where an ECC rule and this file disagree, this file and the
per-app `AGENTS.md` win.

## Code navigation: codebase-memory-mcp

When the [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp)
server is connected, explore through its graph before grepping: `get_architecture`
for the layout, `search_graph` / `search_code` to find symbols, `trace_path` for
call chains, `get_code_snippet` / `get_file_outline` to read, and
`detect_changes` to see what a diff touches. This applies to ECC agents too —
`code-explorer`, `planner` and the reviewers should use it when available. If
`index_status` says the repo is stale or missing, run `index_repository` first.

## Adding or changing a feature

Start from the ECC `orch-*` command that matches the kind of work:

| Work                                     | Command                       |
| ---------------------------------------- | ----------------------------- |
| A capability that does not exist yet     | `/orch-add-feature <what>`    |
| Working behavior that should differ      | `/orch-change-feature <what>` |
| Behavior that is broken or wrong         | `/orch-fix-defect <what>`     |
| Structure to improve, behavior unchanged | `/orch-refine-code <what>`    |

They classify the size, then run Research → Plan → TDD → Review → Commit with
two stops for the user: **approve the plan** before any implementation, and
**confirm the commit** before anything is committed. Honor both. `/plan` and
`/feature-dev` remain for planning without the rest of the pipeline.

The steps below are how each phase is done in this repo, and they override the
pipeline's generic defaults:

1. **Research = this repo first.** Before any library or web search, read
   `docs/domain-map.md`, the `docs/prd.md` section it points to, and explore
   the code through codebase-memory (`code-explorer`). Search GitHub, docs or
   package registries only when the plan needs a new dependency.
2. **The requirement record is part of the plan.** Read the relevant
   `apps/*/docs/` (architecture, design, rules, schema) too. Agreed changes to
   behavior are written into `docs/prd.md` as part of the change, not
   afterwards.
3. **Build in dependency order.** `packages/contracts` (shared types and enums)
   → `apps/api` (schema, migration, routes) → `apps/web` (queries, menus, UI).
4. **Test-first on the API.** Use the `tdd-workflow` skill: write the failing
   `bun test` case next to the code (`apps/api/src/*.test.ts`), make it pass,
   refactor. In `apps/web`, pure logic gets a `bun test` file beside it (e.g.
   `components/menus/fleet-allocation/crew-rows.test.ts`); there are no
   component tests — verify UI through typecheck, lint and build, and do not
   add a test framework without asking.
5. **Database changes** go through Drizzle: edit `apps/api/src/db/schema.ts`,
   then `bun run db:generate`; never hand-edit `apps/api/drizzle/`. Have
   `database-reviewer` look at schema and query changes.
6. **Verify** (the `verification-loop` skill), all from the repo root:
   ```bash
   bun run format:check && bun run lint && bun run typecheck
   (cd apps/api && bun test) && (cd apps/web && bun test)
   bun run build            # web changes: rm -rf apps/web/.next first
   ```
   A failing build or type error → `/build-fix`.
7. **Review.** `/code-review` on the diff; `/react-review` when `apps/web`
   changed; `security-reviewer` for anything touching auth, RBAC, sessions,
   uploads or request validation.
8. **Docs.** Update `docs/prd.md`, the touched `apps/*/docs/`, and
   `docs/domain-map.md` when a rule, gate, endpoint or file it names changes
   (`/update-docs` or the `doc-updater` agent), in the same change.
9. **Commit** small, conventional messages scoped by area, as in the history:
   `feat(reports): …`, `fix(api): …`, `docs(web): …`.

## Where ECC defaults do not apply here

- **Package manager is Bun.** Use `bun run`, `bun test`, `bunx` — not `npm`,
  `npx`, `jest` or `vitest`, even where an ECC command suggests them.
- **Coverage / E2E.** ECC's "80% coverage, unit + integration + E2E all
  required" is a target, not a gate: new logic gets tests; there is no E2E
  suite and no component tests.
- **UI.** Never add Radix or another headless UI library, and never inline a
  color — extend `components/ui/*` with variants and use tokens from
  `app/globals.css` (see `apps/web/AGENTS.md`).
- **Next.js** in this repo is a modified version; read
  `node_modules/next/dist/docs/` before relying on stock behavior.
