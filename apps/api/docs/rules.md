# API rules (mandatory)

The full list. The sharpest two are repeated in `AGENTS.md` because they cause
silent, security-relevant bugs. Reasoning for the shared ones lives in the
root `README.md` ("Conventions worth keeping").

## Security

1. **Never accept a privilege field (`role`) in a request body.** Beyond the
   obvious, `t.Optional(t.UnionEnum([...]))` injects the _first_ enum value
   when the field is absent — an optional `role` silently made every signup an
   admin. `t.Optional(t.String())` and `t.Optional(t.Union([t.Literal…]))` do
   not do this; `UnionEnum` needs an explicit `{ default: … }` if you must use
   it.
2. **Every protected route declares the auth macro.** The web proxy and shell
   are user experience; the macro in `src/auth/macro.ts` is the boundary.
   Write routes must respect the caller's **scope** (`all`/`dept`/`self`) the
   same way read routes do — the dept-scope bug class came from write routes
   reaching past it.
3. **Sessions and cookies**: httpOnly session cookie, Redis-backed. Kiosk
   devices use their own cookie and principal — never mix the two.

## Routes & validation

4. **Every route declares `body`, `params`, and `response` schemas.** Not
   boilerplate: the generated OpenAPI spec is what a mobile client will build
   from; a route missing `response` produces a useless spec downstream.
5. **All routes live under `/v1`** and are mounted in `src/index.ts`. Shipped
   mobile builds lag for weeks; the API stays backward compatible and
   versioned from day one.
6. **TypeBox schemas stay in `apps/api`** (`routes/schemas.ts` for shared
   ones). They are runtime values; putting them in `@universe/contracts`
   pulls Elysia into the browser bundle. Clients get types from Eden/OpenAPI.
7. **Error responses use the `ApiError` shape** (`{ code, message }`) so the
   web can branch on `code`.

## Database

8. **`isUniqueViolation(error, …)` from `src/db`, never `error.code`.**
   Drizzle wraps the driver error; the Postgres `23505` sits on `.cause`, and
   a bare check turns every duplicate into a 500.
9. **Migrations through drizzle-kit only**: edit `schema.ts`, then
   `db:generate` → `db:migrate`. Never hand-edit `drizzle/` or
   `drizzle/meta/`.
10. **Files never go through Postgres.** Bytes land under
    `SOUND_DIR`/`PHOTO_DIR`/`IMPORT_DIR` and stream back with `Bun.file`;
    the row keeps the path.

## Framework

11. **Consult Elysia sources before writing routes** — the `elysiajs` skill in
    `.claude/skills/elysiajs/` or `elysiajs.com/llms.txt`. The API surface
    moves fast; training data is stale.

## Tests

12. Tests are colocated (`src/**/*.test.ts`) and run against the **dev**
    Postgres and Redis: `bun --env-file=.env test [path]`. They drive the real
    route modules (no mocked db). Clean up what you create; never point
    `.env` at a database you care about.
