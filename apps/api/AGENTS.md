# This API runs on Elysia (Bun), not Express or Nest

Elysia is type-first and Bun-native. Its routing, validation (TypeBox),
lifecycle hooks, and the Eden client behave differently from other Node
frameworks, and the API surface moves fast. Before writing or changing a
route, consult the authoritative sources instead of relying on training data:

- The **`elysiajs`** agent skill under `.claude/skills/elysiajs/` — examples,
  plugins, integrations (Drizzle, Eden), and references. If it is not present,
  install it: `bunx skills add elysiajs/skills`.
- [`elysiajs.com/llms.txt`](https://elysiajs.com/llms.txt) for the current API.

## Reference docs — read before working (local `docs/`, gitignored)

| Doc                    | Read it when                                            |
| ---------------------- | ------------------------------------------------------- |
| `docs/architecture.md` | Touching structure, auth, routing, storage, or startup  |
| `docs/schema.md`       | Touching the database or writing queries                |
| `docs/rules.md`        | Writing or changing any route — the full mandatory list |
| `docs/design.md`       | About to change _how_ something works — check the why   |

If `docs/` is absent on this machine, fall back to the root `README.md`
("Conventions worth keeping") and the code itself.

## The two sharpest footguns (cause silent, security-relevant bugs)

- **Never accept a privilege field (`role`) in a request body.** Beyond the
  obvious, `t.Optional(t.UnionEnum([...]))` injects the _first_ enum value when
  the field is absent — an optional `role` silently made every signup an admin.
- **Detect unique-constraint violations with `isUniqueViolation(error, …)` from
  `src/db`, not `error.code`.** Drizzle wraps the driver error, so the Postgres
  `23505` code sits on `.cause`; a bare `error.code` check turns every
  duplicate into a 500.

Also non-negotiable: every route declares `body`, `params`, and `response`
schemas; all routes live under `/v1` and mount in `src/index.ts`; TypeBox
schemas stay in `apps/api` and never leak into `@universe/contracts`.

## Commands

- Tests: `bun --env-file=.env test [path]` — integration tests against the
  dev Postgres and Redis.
- Database: `bun run db:generate` → `bun run db:migrate`; seed with
  `bun run db:seed` (`db:seed:fresh` resets). Never hand-edit `drizzle/`.
