/**
 * The committed OpenAPI document describes every answer an operation can
 * give: its success, the refusals its route returns, and the two that come
 * from the app around every route — 422 `validation_failed` when the request
 * does not match its schema, and 500 `internal_error` (`index.ts`, onError).
 *
 * A client generated from the document, or a reader of it, should never
 * meet a status the document does not mention.
 */

import { describe, expect, test } from "bun:test";

import { buildIntegrationSpec } from "./integrations/openapi";

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

describe("the integration document", () => {
  test("every operation has a success, and every answer says what it means", async () => {
    for (const { name, operation } of operations(
      (await buildIntegrationSpec()) as Spec
    )) {
      const codes = Object.keys(operation.responses);
      expect({ name, success: codes.some((c) => c.startsWith("2")) }).toEqual({
        name,
        success: true,
      });
      for (const [code, response] of Object.entries(operation.responses))
        expect({ name, code, description: response.description }).not.toEqual({
          name,
          code,
          description: expect.stringMatching(PLACEHOLDER),
        });
    }
  });

  test("every operation can answer 500, as the app around it does", async () => {
    for (const { name, operation } of operations(
      (await buildIntegrationSpec()) as Spec
    )) {
      const internal = schemaOf(operation.responses["500"]);
      expect({ name, required: internal?.required }).toEqual({
        name,
        required: ["code", "message"],
      });
    }
  });

  test("an operation that takes input can answer 422 with the fields at fault", async () => {
    for (const { name, operation } of operations(
      (await buildIntegrationSpec()) as Spec
    )) {
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
