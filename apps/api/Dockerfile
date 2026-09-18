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
# Downloaded whole before it is unpacked, not streamed into the extractor.
# Bun 1.3.14 hands a tarball whose download was cut short straight to the
# extractor instead of retrying it (oven-sh/bun#34821), so on a network that
# drops one of the hundreds of parallel downloads the install dies with
# `Fail extracting tarball for "next"` — the largest package, and so the one
# most likely to be cut. It failed three builds on 2026-09-18 — twice on the
# site server, once on a developer machine — while a single `curl` of the same
# tarball came down whole every time. Set on this one command only: nothing at
# runtime installs anything. Drop it once the base image carries the fix.
RUN BUN_FEATURE_FLAG_DISABLE_STREAMING_INSTALL=1 bun install --frozen-lockfile

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
