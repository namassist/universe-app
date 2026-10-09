/**
 * The OpenAPI document handed to other services' teams.
 *
 * What must hold: it describes the integration API and nothing else — the
 * internal API's 130-odd routes stay out — and the copy in `docs/` is the
 * one the code would generate today, so it cannot drift.
 */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { Elysia } from "elysia";

import { integrationRoutes } from "../routes/integrations";
import { buildIntegrationSpec, INTEGRATION_SPEC_PATH } from "./openapi";

type Operation = {
  security?: unknown[];
  parameters?: { name: string; in: string }[];
  responses: Record<
    string,
    {
      content?: Record<string, unknown>;
      headers?: Record<string, unknown>;
    }
  >;
};
type Spec = {
  openapi: string;
  servers: { url: string }[];
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, { scheme?: string }> };
};

describe("buildIntegrationSpec", () => {
  test("holds the three integration reads and nothing else", async () => {
    const spec = (await buildIntegrationSpec()) as Spec;
    expect(Object.keys(spec.paths).sort()).toEqual([
      "/v1/integrations/employees",
      "/v1/integrations/employees/{nik}",
      "/v1/integrations/employees/{nik}/photo",
    ]);
    for (const path of Object.values(spec.paths))
      expect(Object.keys(path)).toEqual(["get"]);
  });

  test("every operation needs the bearer token", async () => {
    const spec = (await buildIntegrationSpec()) as Spec;
    expect(spec.components.securitySchemes.integrationToken?.scheme).toBe(
      "bearer"
    );
    for (const path of Object.values(spec.paths))
      expect(path.get!.security).toEqual([{ integrationToken: [] }]);
  });

  test("names the site and local servers", async () => {
    const spec = (await buildIntegrationSpec()) as Spec;
    expect(spec.servers.map((s) => s.url)).toEqual([
      "http://192.168.151.23:8081",
      "http://localhost:3001",
    ]);
  });

  test("says what the photo route returns: an image, or 304", async () => {
    const spec = (await buildIntegrationSpec()) as Spec;
    const photo = spec.paths["/v1/integrations/employees/{nik}/photo"]!.get!;
    expect(Object.keys(photo.responses["200"]!.content!)).toEqual([
      "image/jpeg",
      "image/png",
      "image/webp",
    ]);
    expect(photo.responses["200"]!.headers).toHaveProperty("ETag");
    expect(photo.responses).toHaveProperty("304");
    expect(photo.parameters?.some((p) => p.name === "If-None-Match")).toBe(
      true
    );
  });

  test("a 429 says when to come back", async () => {
    const spec = (await buildIntegrationSpec()) as Spec;
    for (const path of Object.values(spec.paths))
      expect(path.get!.responses["429"]!.headers).toHaveProperty("Retry-After");
  });
});

describe("OpenAPI 3.0 validity", () => {
  /** Every schema object anywhere in the document. */
  function walk(node: unknown, visit: (n: Record<string, unknown>) => void) {
    if (Array.isArray(node)) return node.forEach((n) => walk(n, visit));
    if (node && typeof node === "object") {
      visit(node as Record<string, unknown>);
      Object.values(node).forEach((n) => walk(n, visit));
    }
  }

  test("uses no 3.1-only schema forms under its 3.0 header", async () => {
    const spec = (await buildIntegrationSpec()) as Spec;
    expect(spec.openapi.startsWith("3.0")).toBe(true);
    const found: string[] = [];
    walk(spec.paths, (n) => {
      if (n.type === "null") found.push("type: null");
      if ("examples" in n && "type" in n) found.push("schema examples");
    });
    expect(found).toEqual([]);
  });

  test("a nullable field is the field marked nullable", async () => {
    const spec = (await buildIntegrationSpec()) as Spec;
    const employee = (
      spec.paths["/v1/integrations/employees/{nik}"]!.get!.responses["200"] as {
        content: {
          "application/json": {
            schema: { properties: Record<string, Record<string, unknown>> };
          };
        };
      }
    ).content["application/json"].schema.properties;
    expect(employee.joinDate).toMatchObject({
      type: "string",
      format: "date",
      nullable: true,
      example: "2019-04-01",
    });
    expect(employee.photo).toMatchObject({ type: "object", nullable: true });
  });
});

describe("stability", () => {
  test("is the same before and after the routes have served a request", async () => {
    // Elysia compiles a route's validators on first use and, in doing so,
    // writes `additionalProperties: false` into its schemas; the document
    // must not depend on which test or request ran first.
    const before = await buildIntegrationSpec();
    await new Elysia()
      .use(integrationRoutes)
      .handle(new Request("http://localhost/integrations/employees"));
    expect(await buildIntegrationSpec()).toEqual(before);
  });

  test("never forbids extra fields — a new field must not break a client", async () => {
    const raw = JSON.stringify(await buildIntegrationSpec());
    expect(raw).not.toContain("additionalProperties");
  });
});

describe("the copy in docs/", () => {
  test("is what the code generates — run `bun run openapi:integration`", async () => {
    const committed = readFileSync(
      join(import.meta.dir, "../../../..", INTEGRATION_SPEC_PATH),
      "utf8"
    );
    expect(JSON.parse(committed)).toEqual(await buildIntegrationSpec());
  });
});
