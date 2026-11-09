/**
 * Shared by the OpenAPI documents this API commits for client generators: the
 * integration API's (`integrations/openapi.ts`) and the mobile app's
 * (`mobile-openapi.ts`).
 */

type Json = Record<string, unknown>;

/**
 * The document says 3.0.3, but TypeBox writes 3.1 forms into it: a schema's
 * `examples: [x]` (3.0 has `example: x`), a nullable value as
 * `anyOf: [X, { type: "null" }]` (3.0 has `nullable: true` on X), a literal as
 * `const: x` (3.0 has `enum: [x]`), and a record as `patternProperties` (3.0
 * has `additionalProperties: X`). Validators and client generators reading
 * 3.0 refuse all of them, so they are rewritten — into a new tree, the
 * generated one untouched.
 *
 * `additionalProperties: false` is dropped too. Elysia writes it into a
 * route's schemas when it first compiles their validators, so its presence
 * depends on whether the route has served a request yet; and a published "no
 * extra fields" would turn every field added later into a breaking change for
 * a strictly generated client.
 */
export function as30(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(as30);
  if (!node || typeof node !== "object") return node;

  const {
    anyOf,
    examples,
    nullable,
    const: literal,
    patternProperties,
    additionalProperties,
    properties,
    ...rest
  } = node as Json & {
    anyOf?: Json[];
    examples?: unknown;
    nullable?: boolean;
    const?: unknown;
    patternProperties?: Record<string, unknown>;
    additionalProperties?: unknown;
    properties?: Record<string, unknown>;
  };
  const out: Json = Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [key, as30(value)])
  );
  /* Field names, not keywords: a field called `const` is still a field. */
  if (properties !== undefined)
    out.properties = Object.fromEntries(
      Object.entries(properties).map(([key, value]) => [key, as30(value)])
    );

  if (Array.isArray(examples) && examples.length) out.example = examples[0];
  else if (examples !== undefined) out.examples = as30(examples);

  if (literal !== undefined) out.enum = [literal];
  const recordValues = patternProperties && Object.values(patternProperties);
  if (recordValues?.length === 1)
    out.additionalProperties = as30(recordValues[0]);
  else if (additionalProperties !== undefined && additionalProperties !== false)
    out.additionalProperties = as30(additionalProperties);

  if (Array.isArray(anyOf)) {
    const branches = anyOf.map(as30) as Json[];
    const real = branches.filter((branch) => branch.type !== "null");
    const single = oneSchema(real);
    if (single && (real.length > 1 || real.length < branches.length)) {
      const merged: Json = { ...out, ...single };
      if (real.length < branches.length || nullable) merged.nullable = true;
      return merged;
    }
    out.anyOf = branches;
  }
  if (nullable !== undefined) out.nullable = nullable;
  return out;
}

/**
 * The one schema a union really is, when it is one:
 * - a single branch, beside `null`;
 * - `t.Numeric()`, published as "a string holding an integer, or an
 *   integer" because Elysia coerces a query string: on the wire it is the
 *   number;
 * - a union of literals, published as one single-value enum per member.
 */
function oneSchema(branches: Json[]): Json | null {
  if (branches.length === 1) return branches[0]!;
  const numeric = branches.filter(
    (b) => b.type === "integer" || b.type === "number"
  );
  const coerced = branches.filter(
    (b) =>
      b.type === "string" && (b.format === "integer" || b.format === "numeric")
  );
  if (numeric.length === 1 && coerced.length === branches.length - 1)
    return numeric[0]!;
  const literals = branches.every(
    (b) =>
      Array.isArray(b.enum) &&
      b.type === branches[0]!.type &&
      Object.keys(b).every((key) => key === "type" || key === "enum")
  );
  if (literals)
    return {
      type: branches[0]!.type,
      enum: branches.flatMap((b) => b.enum as unknown[]),
    };
  return null;
}

/** Responses in status order, so the committed file reads top to bottom. */
export const sortedResponses = (responses: Record<string, Json>) =>
  Object.fromEntries(
    Object.entries(responses).sort(([a], [b]) => a.localeCompare(b))
  );
