/**
 * Both committed OpenAPI documents describe every answer an operation can
 * give: its success, the refusals its route returns, and the two that come
 * from the app around every route — 422 `validation_failed` when the request
 * does not match its schema, and 500 `internal_error` (`index.ts`, onError).
 *
 * A client generated from either document, or a reader of it, should never
 * meet a status the document does not mention.
 */

import { describe, expect, test } from "bun:test";

import { buildIntegrationSpec } from "./integrations/openapi";
import { buildMobileSpec } from "./mobile-openapi";

type Response = {
  description: string;
  content?: Record<string, { schema: Record<string, unknown> }>;
};
type Operation = {
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, Response>;
};
type Spec = { paths: Record<string, Record<string, Operation>> };

const operations = (spec: Spec) =>
  Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).map(([method, operation]) => ({
      name: `${method.toUpperCase()} ${path}`,
      operation,
    }))
  );

const PLACEHOLDER = /^Response for status \d{3}$/;
const schemaOf = (response: Response | undefined) =>
  response?.content?.["application/json"]?.schema as
    { required?: string[]; properties?: Record<string, unknown> } | undefined;

for (const [title, build] of [
  ["the mobile document", buildMobileSpec],
  ["the integration document", buildIntegrationSpec],
] as const) {
  describe(title, () => {
    test("every operation has a success, and every answer says what it means", async () => {
      for (const { name, operation } of operations((await build()) as Spec)) {
        const codes = Object.keys(operation.responses);
        expect({ name, success: codes.some((c) => c.startsWith("2")) }).toEqual(
          { name, success: true }
        );
        for (const [code, response] of Object.entries(operation.responses))
          expect({ name, code, description: response.description }).not.toEqual(
            { name, code, description: expect.stringMatching(PLACEHOLDER) }
          );
      }
    });

    test("every operation can answer 500, as the app around it does", async () => {
      for (const { name, operation } of operations((await build()) as Spec)) {
        const internal = schemaOf(operation.responses["500"]);
        expect({ name, required: internal?.required }).toEqual({
          name,
          required: ["code", "message"],
        });
      }
    });

    test("an operation that takes input can answer 422 with the fields at fault", async () => {
      for (const { name, operation } of operations((await build()) as Spec)) {
        if (!operation.parameters?.length && !operation.requestBody) continue;
        const invalid = schemaOf(operation.responses["422"]);
        expect({
          name,
          fields: Object.keys(invalid?.properties ?? {}),
        }).toEqual({ name, fields: ["code", "message", "issues"] });
        expect(operation.responses["422"]!.description).toContain(
          "validation_failed"
        );
      }
    });
  });
}

test("an operation's own refusal codes are named where it gives them", async () => {
  const spec = (await buildMobileSpec()) as Spec;
  const responses = (path: string, method: string) =>
    spec.paths[path]![method]!.responses;
  expect(responses("/v1/auth/login", "post")["403"]!.description).toContain(
    "first_login_on_site"
  );
  expect(
    responses("/v1/users/{id}/reset-password", "post")["409"]!.description
  ).toContain("own_account");
  expect(
    responses("/v1/fleet-allocation/actual/{date}/{shift}/{unitId}", "patch")[
      "422"
    ]!.description
  ).toContain("ftw_acknowledgement_required");
  /* The session gate's own two, on any operation behind a session. */
  expect(responses("/v1/me/shift", "get")["403"]!.description).toContain(
    "password_change_required"
  );
});
