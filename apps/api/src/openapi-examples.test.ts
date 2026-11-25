/**
 * The committed OpenAPI document carries real values: every field of every
 * success has an example that is not `""`, every error shows a real code and
 * message, and every closed set of values is listed where its field is.
 */

import { describe, expect, test } from "bun:test";

import { buildIntegrationSpec } from "./integrations/openapi";
import {
  FTW_CATEGORIES,
  FTW_DECISIONS,
  missingExamples,
} from "./openapi-examples";
import { KNOWN_CATEGORIES, KNOWN_DECISIONS } from "./readiness";

type Media = {
  schema?: Record<string, unknown>;
  example?: { code?: string; message?: string };
};
type Spec = {
  paths: Record<
    string,
    Record<
      string,
      { responses: Record<string, { content?: Record<string, Media> }> }
    >
  >;
};

const answers = (spec: Spec) =>
  Object.entries(spec.paths).flatMap(([path, methods]) =>
    Object.entries(methods).flatMap(([method, operation]) =>
      Object.entries(operation.responses).flatMap(([status, response]) => {
        const media = response.content?.["application/json"];
        return media
          ? [
              {
                name: `${method.toUpperCase()} ${path} ${status}`,
                status,
                media,
              },
            ]
          : [];
      })
    )
  );

describe("the integration document", () => {
  test("every field of every success has a real example", async () => {
    const missing = answers((await buildIntegrationSpec()) as Spec)
      .filter((a) => a.status.startsWith("2"))
      .flatMap((a) =>
        missingExamples(a.media.schema).map((field) => `${a.name}: ${field}`)
      );
    expect(missing).toEqual([]);
  });

  test("every error shows a real code and message", async () => {
    for (const a of answers((await buildIntegrationSpec()) as Spec)) {
      if (a.status.startsWith("2")) continue;
      expect({ name: a.name, code: a.media.example?.code }).toEqual({
        name: a.name,
        code: expect.stringMatching(/^[a-z_]+$/),
      });
      expect(a.media.example?.message).toBeTruthy();
    }
  });
});

test("the FTW categories and decisions are the rules' own, as savera spells them", () => {
  expect(new Set(FTW_CATEGORIES.map((c) => c.toLowerCase()))).toEqual(
    new Set(KNOWN_CATEGORIES)
  );
  expect(new Set(FTW_DECISIONS.map((c) => c.toLowerCase()))).toEqual(
    new Set(KNOWN_DECISIONS)
  );
});
