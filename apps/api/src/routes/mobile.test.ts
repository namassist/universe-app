/**
 * The version check a sideloaded app makes each time it opens (docs/prd.md,
 * Mobile app → Client stack and distribution). No session: an app too old to
 * be supported has to learn that before it can log in.
 *
 *   bun test src/routes/mobile.test.ts
 */

import { afterEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";

import { mobileRoutes } from "./mobile";

const app = new Elysia().use(mobileRoutes);
const VARS = [
  "MOBILE_ANDROID_MIN_BUILD",
  "MOBILE_ANDROID_LATEST_BUILD",
  "MOBILE_ANDROID_DOWNLOAD_URL",
] as const;
const saved = Object.fromEntries(VARS.map((v) => [v, process.env[v]]));

afterEach(() => {
  for (const v of VARS)
    if (saved[v] === undefined) delete process.env[v];
    else process.env[v] = saved[v];
});

const version = async (platform: string) => {
  const res = await app.handle(
    new Request(`http://localhost/mobile/version?platform=${platform}`)
  );
  return { status: res.status, body: (await res.json()) as unknown };
};

describe("the version check", () => {
  test("answers from configuration, with no session", async () => {
    process.env.MOBILE_ANDROID_MIN_BUILD = "12";
    process.env.MOBILE_ANDROID_LATEST_BUILD = "15";
    process.env.MOBILE_ANDROID_DOWNLOAD_URL =
      "https://universe.example.co.id/universe.apk";
    expect(await version("android")).toEqual({
      status: 200,
      body: {
        platform: "android",
        minimumBuild: 12,
        latestBuild: 15,
        downloadUrl: "https://universe.example.co.id/universe.apk",
      },
    });
  });

  test("unset is null, which the app reads as no requirement", async () => {
    for (const v of VARS) delete process.env[v];
    expect((await version("android")).body).toEqual({
      platform: "android",
      minimumBuild: null,
      latestBuild: null,
      downloadUrl: null,
    });
  });

  test("iOS has nothing to say until there is an Apple account", async () => {
    process.env.MOBILE_ANDROID_MIN_BUILD = "12";
    expect((await version("ios")).body).toMatchObject({
      platform: "ios",
      minimumBuild: null,
    });
  });

  test("a value that is not a build number is not one", async () => {
    // Read as null rather than as 0 or NaN: a typo must not block every
    // phone, and must not let every phone through on a bogus minimum either.
    process.env.MOBILE_ANDROID_MIN_BUILD = "1.2.0";
    process.env.MOBILE_ANDROID_LATEST_BUILD = "-3";
    expect((await version("android")).body).toMatchObject({
      minimumBuild: null,
      latestBuild: null,
    });
  });

  test("a download link that is not http(s) is not offered", async () => {
    process.env.MOBILE_ANDROID_DOWNLOAD_URL = "javascript:alert(1)";
    expect((await version("android")).body).toMatchObject({
      downloadUrl: null,
    });
  });

  test("an unknown platform is refused", async () => {
    expect((await version("windows")).status).toBe(422);
  });
});
