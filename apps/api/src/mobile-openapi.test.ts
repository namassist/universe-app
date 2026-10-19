/**
 * The OpenAPI document the mobile app's Kotlin client is generated from
 * (docs/prd.md, Mobile app → Client stack).
 *
 * What must hold: it describes the routes the app calls and nothing else, in
 * the 3.0 forms a generator reads, and the copy committed under `apps/mobile`
 * is the one the code would generate today. A route changed without
 * `bun run openapi:mobile` fails here instead of in a build weeks later.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildMobileSpec,
  MOBILE_OPERATIONS,
  MOBILE_SPEC_PATH,
} from "./mobile-openapi";

type Json = Record<string, unknown>;
type Spec = {
  openapi: string;
  paths: Record<string, Record<string, unknown>>;
  components: { securitySchemes: Record<string, { scheme?: string }> };
};

const operationsOf = (spec: Spec) =>
  Object.entries(spec.paths)
    .flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`)
    )
    .sort();

describe("buildMobileSpec", () => {
  test("holds exactly the operations the app calls", async () => {
    const spec = (await buildMobileSpec()) as Spec;
    expect(operationsOf(spec)).toEqual([...MOBILE_OPERATIONS].sort());
  });

  test("leaves the rest of the API out", async () => {
    const paths = Object.keys(((await buildMobileSpec()) as Spec).paths);
    for (const internal of [
      "/v1/users/import/commit",
      "/v1/roster/sync",
      "/v1/fit-to-work/sync",
      "/v1/employees",
      /* Mounted groups whose other routes the phone never calls: the wall's
         photo feed, a card's photo, a status change, a regenerated board. */
      "/v1/fleet-allocation/actual/display/photo/{nik}",
      "/v1/id-card/{nik}/photo",
      "/v1/unit-status/{code}",
      "/v1/fleet-allocation/actual/{date}/{shift}/generate",
      "/v1/ops/overview",
      /* The Superadmin's (S6): no account import, no timeline edit, no muster reset. */
      "/v1/users/import/validate",
      "/v1/timeline/{id}",
      "/v1/timeline/reset/{shift}",
    ])
      expect(paths).not.toContain(internal);
  });

  test("publishes only the verbs the phone sends on a shared path", async () => {
    const spec = (await buildMobileSpec()) as Spec;
    /* Deactivating is a PATCH; deleting an account stays on the web. */
    expect(Object.keys(spec.paths["/v1/users/{id}"] ?? {})).toEqual(["patch"]);
    /* The monitor reads; a stage is added or retimed only on the web. */
    expect(spec.paths["/v1/timeline/"]).toBeUndefined();
  });

  test("is written in the 3.0 forms a generator reads", async () => {
    const text = JSON.stringify(await buildMobileSpec());
    expect(text).not.toContain('"type":"null"');
    expect(text).not.toContain('"examples":[');
    expect(text).not.toContain('"additionalProperties":false');
    expect(text).not.toContain('"const":');
    expect(text).not.toContain('"patternProperties":');
  });

  test("claims no defaults a response does not apply", async () => {
    /* TypeBox writes an enum's first member as its default; on a response
       that reads as "absent means plan", and a generated model believes it. */
    const spec = (await buildMobileSpec()) as Spec;
    const responses = Object.values(spec.paths).flatMap((methods) =>
      Object.values(methods).map(
        (operation) => (operation as { responses: unknown }).responses
      )
    );
    expect(JSON.stringify(responses)).not.toContain('"default":');
  });

  test("keeps a response's closed lists open, for builds already installed", async () => {
    /* A sideloaded build stays in use for weeks (docs/prd.md, Mobile app →
       Client stack). A generated enum would make that build fail to read the
       whole answer the day a value is added; a string it does not recognise
       is one it can still show. */
    const spec = (await buildMobileSpec()) as Spec;
    const responses = Object.values(spec.paths).flatMap((methods) =>
      Object.values(methods).map(
        (operation) => (operation as { responses: unknown }).responses
      )
    );
    expect(JSON.stringify(responses)).not.toContain('"enum":');
  });

  test("reads the session's principal as a person, never a display", async () => {
    const spec = (await buildMobileSpec()) as Spec;
    const session = spec.paths["/v1/auth/session"]?.get as {
      responses: Record<
        string,
        { content: Record<string, { schema: { properties: Json } }> }
      >;
    };
    const principal = session.responses["200"]!.content["application/json"]!
      .schema.properties.principal as Json & { properties: Json };
    expect(principal.anyOf).toBeUndefined();
    expect(Object.keys(principal.properties)).toContain("mustChangePassword");
  });

  test("names the bearer session the app signs in with", async () => {
    const spec = (await buildMobileSpec()) as Spec;
    expect(spec.components.securitySchemes.session?.scheme).toBe("bearer");
  });

  test("matches the copy committed for the app", async () => {
    const committed = JSON.parse(
      readFileSync(join(import.meta.dir, "../../..", MOBILE_SPEC_PATH), "utf8")
    );
    expect(committed).toEqual(
      JSON.parse(JSON.stringify(await buildMobileSpec()))
    );
  });
});
