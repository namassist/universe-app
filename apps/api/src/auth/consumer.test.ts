import { describe, expect, test } from "bun:test";
import type { SessionPrincipal } from "@universe/contracts";
import { Elysia } from "elysia";

import { consumerFor, identifyConsumer, trackConsumers } from "./consumer";

const user = {
  kind: "user",
  id: "u1",
  name: "Budi",
  email: null,
  nik: null,
  roleId: "r1",
  roleName: "Dispatcher",
  scope: { kind: "all" },
  mustChangePassword: false,
} as unknown as SessionPrincipal;

const device: SessionPrincipal = {
  kind: "device",
  id: "d1",
  name: "Wall 1",
  deviceKind: "wall" as never,
};

describe("consumerFor", () => {
  test("a user is identified by id, named, and grouped by role", () => {
    expect(consumerFor(user)).toEqual({
      identifier: "user:u1",
      name: "Budi",
      group: "Dispatcher",
    });
  });

  test("a device is grouped by its kind, apart from users", () => {
    expect(consumerFor(device)).toEqual({
      identifier: "device:d1",
      name: "Wall 1",
      group: "device:wall",
    });
  });
});

/**
 * Wired the way the Apitally plugin is: a decorated `apitally` read back in
 * onAfterResponse. Run against a listening server, not `app.handle` — only
 * the compiled server shares the decorator between requests, which is the
 * race this guards.
 */
describe("trackConsumers", () => {
  test("each concurrent request reports its own consumer, and none leaks", async () => {
    const seen: Record<string, string | undefined> = {};
    const app = new Elysia()
      .decorate("apitally", {} as { consumer?: { identifier: string } })
      .onAfterResponse(({ apitally, path }) => {
        seen[path] = apitally.consumer?.identifier;
      })
      .use(trackConsumers)
      .get("/user", async () => {
        identifyConsumer(user);
        await Bun.sleep(40);
        return "ok";
      })
      .get("/device", async () => {
        identifyConsumer(device);
        await Bun.sleep(5);
        return "ok";
      })
      .get("/anon", async () => {
        await Bun.sleep(15);
        return "ok";
      })
      .listen(0);

    try {
      const base = `http://127.0.0.1:${app.server!.port}`;
      await Promise.all(
        ["/user", "/device", "/anon"].map((p) => fetch(base + p))
      );
      await Bun.sleep(50);
      expect(seen).toEqual({
        "/user": "user:u1",
        "/device": "device:d1",
        "/anon": undefined,
      });
    } finally {
      app.stop();
    }
  });

  test("identifying outside a tracked request is a no-op", () => {
    expect(() => identifyConsumer(user)).not.toThrow();
  });
});
