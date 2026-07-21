# This API runs on Elysia (Bun), not Express or Nest

Elysia is type-first and Bun-native. Its routing, validation (TypeBox),
lifecycle hooks, and the Eden client behave differently from other Node
frameworks, and the API surface moves fast. Before writing or changing a route,
consult the authoritative sources instead of relying on training data:

- The **`elysiajs`** agent skill under `.claude/skills/elysiajs/` — examples,
  plugins, integrations (Drizzle, Eden), and references (lifecycle, validation,
  testing). If it is not present, install it: `bunx skills add elysiajs/skills`.
- [`elysiajs.com/llms.txt`](https://elysiajs.com/llms.txt) for the current API.

## Project rules the framework docs will not tell you

See the root `README.md` ("Conventions worth keeping") for the full list and the
reasoning. The two sharpest footguns, repeated here because they cause silent,
security-relevant bugs:

- **Never accept a privilege field (`role`) in a request body.** Beyond the
  obvious, `t.Optional(t.UnionEnum([...]))` injects the _first_ enum value when
  the field is absent — an optional `role` silently made every signup an admin.
- **Detect unique-constraint violations with `isUniqueViolation(error, …)` from
  `src/db`, not `error.code`.** Drizzle wraps the driver error, so the Postgres
  `23505` code sits on `.cause`; a bare `error.code` check turns every duplicate
  into a 500.

Also non-negotiable: every route declares `body`, `params`, and `response`
schemas; all routes live under `/v1`; TypeBox schemas stay in `apps/api` and
never leak into `@universe/contracts` (the browser bundle).
