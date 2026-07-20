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
bun run dev          # turbo runs api + web together
```

- Web: http://localhost:3000
- API: http://localhost:3001/health
- OpenAPI: http://localhost:3001/openapi

## How the type safety works

`apps/api` exports `type App = typeof app`. `apps/web` imports it and hands it to
Eden Treaty:

```ts
import { treaty } from '@elysiajs/eden'
import type { App } from '@universe/api'

export const api = treaty<App>(API_URL)
await api.v1.users.get()          // return type inferred from the route
```

Type-only, so no server code reaches the browser bundle, and there is no codegen
step. Rename a field in an Elysia route and the web app fails to typecheck.

## Conventions worth keeping

**Every route declares `body`, `params`, and `response` schemas.** Not
boilerplate — that is what makes the generated OpenAPI spec complete, which is
what a Flutter or native mobile client will generate its client from. A route
missing `response` produces a spec that is useless downstream.

**Routes live under `/v1`.** Web deploys in lockstep with the API; a shipped
mobile build does not. Users sit on old versions for weeks, so the API has to
stay backward compatible and versioned from the start.

**`packages/contracts` must stay browser-safe.** No db client, no secrets, no
node builtins — it is imported by the client bundle. Server-only code belongs in
`apps/api`, and a future `packages/db` should only ever be imported there.

**TypeBox schemas stay in `apps/api`.** They are runtime values; putting them in
`contracts` would pull Elysia into the browser bundle. Web and mobile get their
types from Eden and OpenAPI instead.

## Not done yet

- **Auth** — decide before writing more endpoints. Web can use httpOnly cookies,
  mobile cannot; you want one session store serving cookies *and* bearer tokens,
  not two auth systems. Retrofitting this touches every route.
- **Database** — `packages/db`, imported only by `apps/api`.
- **Mobile** — if React Native/Expo, it goes in `apps/mobile` and uses Eden like
  web does. If Flutter/native, it lives outside this repo and consumes the
  OpenAPI spec instead.

## Deploy

`apps/api` is a long-lived Bun process — Fly.io, Railway, or Docker on a VPS.
Not serverless: mobile clients need a stable endpoint, and cold starts hurt.
`apps/web` goes to Vercel. They deploy separately.
