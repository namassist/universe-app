# Shared contracts — browser-safe by contract

This package is imported by the client bundle. Nothing here may pull in
server-only code: no db client, no secrets, no Node/Bun builtins, no Elysia,
no TypeBox. TypeBox schemas are runtime values and belong in `apps/api`; web
and mobile get their API types from Eden and the generated OpenAPI spec, not
from schemas placed here.

If a type needs server-only context to define, it belongs in `apps/api/src`,
not in this package.
