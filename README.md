# universe-app

Monorepo: Elysia (Bun) API + Next.js web, with a mobile client to follow.

```
apps/
  api/         Elysia on Bun — :3001
  web/         Next.js 16 App Router — :3000
packages/
  contracts/   Types + constants shared with the browser. Nothing server-only.
```

## Getting started

```bash
bun install
cp apps/api/.env.example apps/api/.env
cp apps/web/.env.example apps/web/.env.local
# fill in DATABASE_URL, then:
bun run --cwd apps/api db:migrate
bun run dev          # turbo runs api + web together
```

- Web: http://localhost:3000
- API: http://localhost:3001/health — reports `database` and `cache` separately, 503 if either is down
- OpenAPI: http://localhost:3001/openapi

## Code style & tooling

Prettier formats, ESLint lints, and a Husky `pre-commit` hook runs `lint-staged`
so nothing unformatted or unlinted lands in a commit. The hook only touches
staged files; it is not a substitute for `bun run lint` in CI.

```bash
bun run format         # prettier --write across the repo
bun run format:check   # verify formatting (use this in CI)
bun run lint           # eslint every package
bun run lint:fix       # eslint --fix every package
```

- **One ESLint config at the root** (`eslint.config.mjs`), scoped per package
  with `files`. It has to live at the root, not per package, because the
  pre-commit hook runs `eslint` from the repo root — a config nested in
  `apps/web` would be invisible to it. `typescript-eslint` covers `apps/api` and
  `packages/*`; `eslint-config-next` covers `apps/web`; `eslint-config-prettier`
  runs last so lint rules never fight the formatter.
- **All lint/format tooling is a root devDependency**, not per package. Bun's
  isolated linker only exposes a package's deps inside that package, so a plugin
  declared in `apps/web` cannot be resolved when the tool runs from the root.
  Keep new shared tooling at the root for the same reason.
- **Prettier style is `semi: true`, double quotes, `printWidth: 80`** — the same
  as the sibling `universe` repo, on purpose, so code reads the same across both.
  `apps/web` extends it with import sorting and the Tailwind class sorter.
- **No arbitrary hex colors in `className`** (`bg-[#fff]`) — ESLint rejects them;
  use a design token from `app/globals.css`.
- **`.editorconfig` + `.vscode/`** are committed: install the recommended
  extensions and format-on-save matches the hook, so you rarely hit it.

## AI coding skills

The project pins the official [ElysiaJS agent skill](https://github.com/elysiajs/skills)
so an AI agent (Claude Code, OpenCode) reasons about Elysia from its real docs —
routing, validation, lifecycle, plugins, and Eden — instead of guessing.

The skill files themselves are per-machine (materialized under `.claude/`, which
is gitignored like `node_modules`). The shared, tracked artifact is
`skills-lock.json` at the root — a pinned source + content hash. To set it up on
your machine:

```bash
bunx skills add elysiajs/skills   # installs into .claude/skills/elysiajs
```

A newly installed skill is picked up by the _next_ agent session, not the one
that installed it. Bump it later with `bunx skills update`.

## Database

Postgres via Drizzle, Redis via ioredis. Both live in the shared dev containers
under `~/Workspaces/databases`, but this project owns its own Postgres role and
database (`universe_app`) and its own Redis db index (2) — `universe` is a
different project's database, do not point at it.

```bash
bun run --cwd apps/api db:generate   # schema change -> SQL migration
bun run --cwd apps/api db:migrate    # apply pending migrations
bun run --cwd apps/api db:studio     # browse data
```

Schema lives in `apps/api/src/db/schema.ts`, migrations are committed under
`apps/api/drizzle/`. Enum values come from `@universe/contracts` so the database,
the API schema, and the client cannot drift apart.

Use `isUniqueViolation(error, 'constraint_name')` from `src/db` rather than
checking `error.code` — Drizzle wraps driver errors, so the Postgres error code
sits on `.cause`, and a bare `error.code` check silently turns every duplicate
into a 500.

## How the type safety works

`apps/api` exports `type App = typeof app`. `apps/web` imports it and hands it to
Eden Treaty:

```ts
import { treaty } from "@elysiajs/eden";
import type { App } from "@universe/api";

export const api = treaty<App>(API_URL);
await api.v1.users.get(); // return type inferred from the route
```

Type-only, so no server code reaches the browser bundle, and there is no codegen
step. Rename a field in an Elysia route and the web app fails to typecheck.

## Data fetching on the web (TanStack Query)

Two paradigms live side by side, on purpose:

- **Server Components fetch on the server.** The first paint of a route runs the
  Eden call server-side (the API need not be reachable from the browser).
- **Client Components read from TanStack Query.** Anything interactive —
  mutations, refetch-on-focus, polling, optimistic updates — goes through the
  cache, not another `await`.

The two are bridged by prefetch + hydration, so the client renders with data on
the first frame and never double-fetches:

```tsx
// page.tsx (Server Component)
const queryClient = getQueryClient();
await queryClient.prefetchQuery(usersQueryOptions);
return (
  <HydrationBoundary state={dehydrate(queryClient)}>
    <UsersList /> {/* useQuery(usersQueryOptions) — data already there */}
  </HydrationBoundary>
);
```

Rules that keep this safe:

- **A query is defined once, in `lib/queries/*`, via `queryOptions`.** Server
  prefetch and client `useQuery` import the same object, so the key and the
  fetcher cannot drift. Its `queryFn` is `unwrap(api…)` — Eden's typed client
  behind the value-or-throw shape `queryFn` expects.
- **`getQueryClient()` makes a fresh client per request on the server** and
  reuses a singleton in the browser. A server-side singleton would leak one
  user's cache into another's.
- **Mutations invalidate, they do not `router.refresh()`.** `useMutation` throws
  Eden's error so it lands in `onError` with the status union intact, and
  `onSuccess` calls `invalidateQueries` to refetch just the affected key.
- **Server data never goes into client state (Zustand, etc.).** TanStack Query
  is the cache; a second copy is a sync bug waiting to happen.

## Conventions worth keeping

**Every route declares `body`, `params`, and `response` schemas.** Not
boilerplate — that is what makes the generated OpenAPI spec complete, which is
what a Flutter or native mobile client will generate its client from. A route
missing `response` produces a spec that is useless downstream.

**Routes live under `/v1`.** Web deploys in lockstep with the API; a shipped
mobile build does not. Users sit on old versions for weeks, so the API has to
stay backward compatible and versioned from the start.

**`packages/contracts` must stay browser-safe.** No db client, no secrets, no
node builtins — it is imported by the client bundle. Server-only code, including
`src/db`, belongs in `apps/api`.

**Never put a privilege field in a request body.** Beyond the obvious reason,
`t.Optional(t.UnionEnum([...]))` injects the _first_ enum value when the field
is absent — an optional `role` on the create route silently made every signup an
admin. Plain `t.Optional(t.String())` and `t.Optional(t.Union([t.Literal…]))` do
not do this; `UnionEnum` needs an explicit `{ default: … }` if you must use it.

**TypeBox schemas stay in `apps/api`.** They are runtime values; putting them in
`contracts` would pull Elysia into the browser bundle. Web and mobile get their
types from Eden and OpenAPI instead.

## Not done yet

- **Auth** — decide before writing more endpoints. Web can use httpOnly cookies,
  mobile cannot; you want one session store serving cookies _and_ bearer tokens,
  not two auth systems. Retrofitting this touches every route.
- **Redis is unauthenticated.** The shared dev container has no password and no
  ACL, so the db index in `REDIS_URL` is a convention between projects, not a
  boundary — anything on this machine can read or flush our keys. Fine for dev,
  never for production.
- **Mobile** — if React Native/Expo, it goes in `apps/mobile` and uses Eden like
  web does. If Flutter/native, it lives outside this repo and consumes the
  OpenAPI spec instead.

## Deploy

`apps/api` is a long-lived Bun process — Fly.io, Railway, or Docker on a VPS.
Not serverless: mobile clients need a stable endpoint, and cold starts hurt.
`apps/web` goes to Vercel. They deploy separately.
