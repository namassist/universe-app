/**
 * The 3.1 forms TypeBox writes, rewritten into the 3.0 a client generator
 * reads (`openapi-30.ts`).
 */

import { describe, expect, test } from "bun:test";

import { as30 } from "./openapi-30";

describe("as30", () => {
  test("a nullable value becomes 3.0's nullable flag", () => {
    expect(as30({ anyOf: [{ type: "string" }, { type: "null" }] })).toEqual({
      type: "string",
      nullable: true,
    });
  });

  test("a literal becomes a one-value enum", () => {
    expect(as30({ type: "string", const: "user" })).toEqual({
      type: "string",
      enum: ["user"],
    });
  });

  test("a record becomes a map of its value schema", () => {
    expect(
      as30({ type: "object", patternProperties: { "^(.*)$": {} } })
    ).toEqual({ type: "object", additionalProperties: {} });
  });

  test("a closed object is published open", () => {
    expect(
      as30({ type: "object", properties: {}, additionalProperties: false })
    ).toEqual({ type: "object", properties: {} });
  });

  test("a coerced number is published as the number it is", () => {
    expect(
      as30({
        minimum: 1,
        anyOf: [
          { type: "string", format: "integer", default: 0 },
          { type: "integer", minimum: 1 },
        ],
      })
    ).toEqual({ type: "integer", minimum: 1 });
  });

  test("a union of literals becomes one enum", () => {
    expect(
      as30({
        anyOf: [
          { type: "string", enum: ["day"] },
          { type: "string", enum: ["night"] },
        ],
        nullable: true,
      })
    ).toEqual({ type: "string", enum: ["day", "night"], nullable: true });
  });
});
