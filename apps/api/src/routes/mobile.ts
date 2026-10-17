/**
 * What the mobile app asks before anything else: is this build still
 * supported (docs/prd.md, Mobile app → Client stack and distribution).
 *
 * Sideloaded builds do not update themselves, so each one asks on opening.
 * Below the minimum it blocks with a download button; between the minimum
 * and the latest it offers the update and lets the person carry on.
 *
 * No session, deliberately: an app too old to talk to this API must still
 * be able to learn that it is too old, before it tries to log in. It reveals
 * three numbers the download page would show anyway.
 *
 * Read from the environment on every request, so a release is a config
 * change and a restart, not a build of the API:
 * `MOBILE_<PLATFORM>_MIN_BUILD`, `_LATEST_BUILD`, `_DOWNLOAD_URL`.
 */

import { Elysia, t } from "elysia";
import { PUSH_PLATFORMS, type PushPlatform } from "@universe/contracts";

/** A build number, or null for anything that is not one. */
function buildNumber(raw: string | undefined): number | null {
  const value = raw?.trim();
  return value && /^\d+$/.test(value) ? Number(value) : null;
}

/** Only an http(s) link is offered: the app opens it in the browser. */
function downloadUrl(raw: string | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? value : null;
  } catch {
    return null;
  }
}

function versionOf(platform: PushPlatform) {
  const prefix = `MOBILE_${platform.toUpperCase()}`;
  return {
    platform,
    minimumBuild: buildNumber(process.env[`${prefix}_MIN_BUILD`]),
    latestBuild: buildNumber(process.env[`${prefix}_LATEST_BUILD`]),
    downloadUrl: downloadUrl(process.env[`${prefix}_DOWNLOAD_URL`]),
  };
}

export const mobileRoutes = new Elysia({
  prefix: "/mobile",
  tags: ["mobile"],
}).get("/version", ({ query }) => versionOf(query.platform), {
  query: t.Object({ platform: t.UnionEnum(PUSH_PLATFORMS) }),
  response: {
    200: t.Object({
      platform: t.UnionEnum(PUSH_PLATFORMS),
      /** Below this the app refuses to run and offers the download. */
      minimumBuild: t.Nullable(t.Number()),
      /** Below this, and at or above the minimum, it offers the update. */
      latestBuild: t.Nullable(t.Number()),
      downloadUrl: t.Nullable(t.String()),
    }),
  },
  detail: { summary: "Whether this app build is still supported" },
});
