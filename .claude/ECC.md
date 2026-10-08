# ECC in this repo

[ECC](https://github.com/affaan-m/ECC) (MIT, see `ECC-LICENSE`) is the agent
workflow for universe-app. Only a curated subset is vendored here — the pinned
version is in `ecc-version`. Everything is managed by `scripts/sync-ecc.sh`;
do not hand-edit these files (project guidance belongs in the root
`CLAUDE.md` or `apps/*/AGENTS.md`).

| Kind | Where | What |
| --- | --- | --- |
| Commands | `commands/` | `/orch-add-feature`, `/orch-change-feature`, `/orch-fix-defect`, `/orch-refine-code`, `/plan`, `/feature-dev`, `/code-review`, `/react-review`, `/build-fix`, `/test-coverage`, `/refactor-clean`, `/update-docs`, `/security-scan`, `/checkpoint`, `/learn`, `/save-session`, `/resume-session` |
| Agents | `agents/` | planner, architect, code-explorer, code-architect, code-reviewer, typescript-reviewer, react-reviewer, database-reviewer, security-reviewer, build-error-resolver, tdd-guide, refactor-cleaner, doc-updater, silent-failure-hunter |
| Skills | `skills/` | tdd-workflow, verification-loop, coding-standards, backend-patterns, frontend-patterns, api-design, bun-runtime, react-patterns, react-testing, accessibility, postgres-patterns, redis-patterns, database-migrations, docker-patterns, deployment-patterns, security-review, security-scan, search-first, git-workflow, error-handling, strategic-compact, orch-pipeline, orch-add-feature, orch-change-feature, orch-fix-defect, orch-refine-code |
| Rules | `rules/ecc/` | `common` (always loaded), `typescript`, `react`, `web` (path-scoped, loaded only for matching files) |

Not vendored on purpose: the ECC hook runtime (the repo's own husky +
lint-staged already formats and lints on commit), MCP configs, the language
packs this stack does not use, `orch-build-mvp` (needs `/gan-build`; the app
already exists) and `/orch-review` (needs ECC's separate Workflow runtime;
`/code-review` covers it).

Alongside ECC:

- `skills/elysiajs` — not ECC: a link to the ElysiaJS skill committed under
  `.agents/skills/elysiajs/`, managed by `bunx skills` and pinned in
  `skills-lock.json` (update with `bunx skills update`).
- [codebase-memory-mcp](https://github.com/DeusData/codebase-memory-mcp) —
  the code-graph MCP server. Its installer configures Claude Code itself
  (`~/.claude.json`, hooks, skill); nothing for it is vendored here. How agents
  use it is in the root `CLAUDE.md`.

## Updating

```bash
scripts/sync-ecc.sh            # latest main
scripts/sync-ecc.sh v2.3.0     # a specific tag
git diff -- .claude            # review before committing
```

To add a component, append it to the matching list in the script and re-run.
