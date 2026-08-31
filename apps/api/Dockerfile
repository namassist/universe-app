# The API, run from source rather than from a bundle.
#
# Bun executes TypeScript directly, so bundling would buy nothing here and
# would cost the one thing the image needs: `drizzle-kit`, which reads
# `src/db/schema.ts` and the `drizzle/` folder to apply migrations. The same
# image therefore serves the API and runs the migration and bootstrap steps.
#
# One stage on purpose. A separate `deps` stage looks tidier but is wrong for a
# Bun workspace: `bun install` writes a `node_modules/.bin` into *each*
# workspace member as well as the root, and copying only the root's leaves
# `drizzle-kit` unresolvable — a failure that appears at the first migration,
# not at build time. Layer caching is preserved the ordinary way instead: the
# manifests are copied and installed before any source, so editing code does
# not re-resolve the tree.
FROM oven/bun:1.3.14
WORKDIR /app
ENV NODE_ENV=production

# Every workspace member's package.json has to be present or bun refuses to
# install the workspace at all.
COPY package.json bun.lock ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api

# Written to at runtime: uploaded sounds, employee photos, import files. These
# are mount points — a named volume must cover them, or every upload is lost on
# the next deploy while the database goes on claiming the file exists.
RUN mkdir -p /data/sounds /data/photos /data/imports

WORKDIR /app/apps/api
EXPOSE 3001
CMD ["bun", "src/index.ts"]
