/**
 * The committed OpenAPI documents carry real values: every field of every
 * success has an example that is not `""`, every error shows a real code and
 * message, and every closed set of values is listed where its field is.
 */

import { describe, expect, test } from "bun:test";
import { t } from "elysia";
import { TypeCompiler } from "elysia/type-system";
import { ROSTER_CODES } from "@universe/contracts";

import { buildIntegrationSpec } from "./integrations/openapi";
import { SHIFT_EXAMPLES } from "./mobile-openapi-examples";
import { buildMobileSpec } from "./mobile-openapi";
import {
  FTW_CATEGORIES,
  FTW_DECISIONS,
  missingExamples,
} from "./openapi-examples";
import { KNOWN_CATEGORIES, KNOWN_DECISIONS } from "./readiness";
import { MyShiftSchema } from "./routes/me";

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

for (const [title, build] of [
  ["the mobile document", buildMobileSpec],
  ["the integration document", buildIntegrationSpec],
] as const) {
  describe(title, () => {
    test("every field of every success has a real example", async () => {
      const missing = answers((await build()) as Spec)
        .filter((a) => a.status.startsWith("2"))
        .flatMap((a) =>
          missingExamples(a.media.schema).map((field) => `${a.name}: ${field}`)
        );
      expect(missing).toEqual([]);
    });

    test("every error shows a real code and message", async () => {
      for (const a of answers((await build()) as Spec)) {
        if (a.status.startsWith("2")) continue;
        expect({ name: a.name, code: a.media.example?.code }).toEqual({
          name: a.name,
          code: expect.stringMatching(/^[a-z_]+$/),
        });
        expect(a.media.example?.message).toBeTruthy();
      }
    });
  });
}

const shiftSchema = async () => {
  const spec = (await buildMobileSpec()) as Spec;
  const media = spec.paths["/v1/me/shift"]!.get!.responses["200"]!.content![
    "application/json"
  ]! as Media & { examples?: Record<string, unknown> };
  const shift = (
    media.schema!.properties as Record<string, Record<string, unknown>>
  ).shift!;
  return {
    media,
    fields: shift.properties as Record<string, Record<string, unknown>>,
  };
};

describe("the values a field can take", () => {
  test("an enum's members are listed, though the mobile document drops `enum`", async () => {
    const { fields } = await shiftSchema();
    expect(fields.status!.enum).toBeUndefined();
    expect(fields.status!.description).toContain(
      "`holder`, `spare`, `off`, `not-allocated`"
    );
    expect(fields.status!.example).toBe("holder");
    expect(String(fields.reason!.description)).toContain(
      "`awaiting-second-finger`"
    );
  });

  test("ftw.category lists every category savera sends, as it spells them", async () => {
    const { fields } = await shiftSchema();
    const ftw = fields.ftw!.properties as Record<
      string,
      Record<string, unknown>
    >;
    for (const category of FTW_CATEGORIES)
      expect(ftw.category!.description).toContain(`\`${category}\``);
    expect(ftw.category!.example).toBe("Dapat Bekerja");
    /* The spelling is the documents'; the set is the rules' own. */
    expect(new Set(FTW_CATEGORIES.map((c) => c.toLowerCase()))).toEqual(
      new Set(KNOWN_CATEGORIES)
    );
    expect(new Set(FTW_DECISIONS.map((c) => c.toLowerCase()))).toEqual(
      new Set(KNOWN_DECISIONS)
    );
  });

  test("the roster code lists every code", async () => {
    const { fields } = await shiftSchema();
    for (const code of ROSTER_CODES)
      expect(fields.roster!.description).toContain(`\`${code}\``);
  });
});

describe("the Beranda examples of /me/shift", () => {
  const Response = TypeCompiler.Compile(
    t.Object({ shift: t.Nullable(MyShiftSchema) })
  );

  test("each is an answer the route could really give", () => {
    for (const [name, { value }] of Object.entries(SHIFT_EXAMPLES))
      expect({ name, ok: Response.Check(value) }).toEqual({
        name,
        ok: true,
      });
  });

  test("between them they show every status and every reason", () => {
    const shifts = Object.values(SHIFT_EXAMPLES)
      .map(
        ({ value }) =>
          (value as { shift: Record<string, unknown> | null }).shift
      )
      .filter((s): s is Record<string, unknown> => s !== null);
    expect(new Set(shifts.map((s) => s.status))).toEqual(
      new Set(["holder", "spare", "off", "not-allocated"])
    );
    expect(new Set(shifts.map((s) => s.reason).filter(Boolean))).toEqual(
      new Set([
        "breakdown",
        "not-in-fleet",
        "ineligible",
        "partner-rostered",
        "no-plan-seat",
        "awaiting-second-finger",
        "not-seated",
      ])
    );
  });

  test("are published on the operation", async () => {
    const { media } = await shiftSchema();
    expect(Object.keys(media.examples ?? {})).toEqual(
      Object.keys(SHIFT_EXAMPLES)
    );
  });
});
