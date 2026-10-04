/**
 * Who made a request, for Apitally's per-consumer metrics.
 *
 * The plugin reads `apitally.consumer` from its `onAfterResponse` hook, off an
 * object it registers with `decorate("apitally", {})`. Under a running server
 * that is one object for the whole process, so the documented
 * `apitally.consumer = …` races: concurrent requests overwrite each other, and
 * every later anonymous request is reported as whoever came last. Nor can a
 * per-request value be handed over through `derive` or `resolve` — the hook
 * sees only the decorator.
 *
 * So that object's `consumer` becomes a getter reading from an
 * AsyncLocalStorage store entered at the start of each request, and
 * `identifyConsumer` writes into that store. Each request reads back exactly
 * what it wrote.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import type { SessionPrincipal } from "@universe/contracts";
import type { ApitallyConsumer } from "apitally/elysia";
import type { Elysia } from "elysia";

const scope = new AsyncLocalStorage<{ consumer?: ApitallyConsumer }>();

/**
 * Mount directly after the Apitally plugin, before any route. Without it
 * `identifyConsumer` finds no store and does nothing, which is also what
 * happens — correctly — when monitoring is off.
 *
 * The getter goes onto the plugin's own decorated object rather than a
 * replacement decorator: its hook keeps the object it was registered with,
 * and an override is never seen there.
 */
export const trackConsumers = (app: Elysia) => {
  const target = (app.decorator as { apitally?: object }).apitally;
  if (target)
    Object.defineProperty(target, "consumer", {
      configurable: true,
      get: () => scope.getStore()?.consumer,
      // Swallows a stray `apitally.consumer = …`, which would otherwise leak
      // across requests exactly as described above.
      set: () => {},
    });
  return app.onRequest(() => scope.enterWith({}));
};

/**
 * Prefixed because users and devices are separate tables and their ids are
 * not guaranteed disjoint. Users are grouped by role and devices by kind, the
 * two axes a question about traffic is usually asked along.
 */
export function consumerFor(principal: SessionPrincipal): ApitallyConsumer {
  return principal.kind === "user"
    ? {
        identifier: `user:${principal.id}`,
        name: principal.name,
        group: principal.roleName,
      }
    : {
        identifier: `device:${principal.id}`,
        name: principal.name,
        group: `device:${principal.deviceKind}`,
      };
}

export function identifyConsumer(principal: SessionPrincipal): void {
  const store = scope.getStore();
  if (store) store.consumer = consumerFor(principal);
}
