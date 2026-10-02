/**
 * Every Redis key the Operations Center writes, under one prefix.
 *
 * `bun test` runs against the same Redis as development, and these keys feed
 * a page somebody may have open. Under `NODE_ENV=test` they live under
 * `ops-test:` instead, so a test run can never put "Uji Ops" on the dev page
 * or bend its per-minute chart — and the test can clear its whole namespace.
 */
export function opsKey(suffix: string): string {
  const prefix = process.env.NODE_ENV === "test" ? "ops-test" : "ops";
  return `${prefix}:${suffix}`;
}
