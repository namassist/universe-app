# The web app.
#
# Two things about this build are easy to get wrong and expensive to discover
# later:
#
#  1. `NEXT_PUBLIC_API_URL` is read at BUILD time and baked into the browser
#     bundle. It cannot be supplied as a runtime environment variable — a
#     container started with the right value and built with the wrong one will
#     boot cleanly and fail every request. Hence the build arg.
#
#  2. The app imports `@universe/api` for Eden's type inference, so the API
#     source has to be in the build context even though nothing of it ships in
#     the output.
#
#  3. The install happens in the build stage rather than a separate `deps` one.
#     `bun install` writes a `node_modules/.bin` into each workspace member as
#     well as the root, so copying only the root's across stages leaves `next`
#     unresolvable. Caching is preserved by copying manifests before source.
FROM oven/bun:1.3.14 AS build
WORKDIR /app
COPY package.json bun.lock ./
COPY packages/contracts/package.json packages/contracts/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
RUN bun install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY apps/api apps/api
COPY apps/web apps/web

ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV NEXT_TELEMETRY_DISABLED=1
RUN test -n "$NEXT_PUBLIC_API_URL" || \
      (echo "NEXT_PUBLIC_API_URL build arg is required" && exit 1)
RUN cd apps/web && bun run build

FROM oven/bun:1.3.14 AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# The standalone output carries its own trimmed node_modules and server.js;
# static assets and the public folder are not traced into it and are copied
# alongside, at the paths the server expects.
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public

EXPOSE 3000
CMD ["bun", "apps/web/server.js"]
