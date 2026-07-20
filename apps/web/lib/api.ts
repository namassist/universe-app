import { treaty } from '@elysiajs/eden'
import type { App } from '@universe/api'

/**
 * Typed client for the Elysia API.
 *
 * `App` is a type-only import — erased at build, so no server code, no Elysia,
 * and nothing from apps/api ends up in the browser bundle. Changing a route's
 * schema in apps/api turns into a red squiggle here, with no codegen step.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001'

export const api = treaty<App>(API_URL)

/**
 * Eden returns `{ data, error }` rather than throwing. That is the point —
 * `error` is a discriminated union of the exact status codes the route
 * declares, so handling a 404 vs a 409 is checked at compile time.
 * This helper is for the cases where you just want the value or a throw.
 */
export async function unwrap<T>(
  promise: Promise<{ data: T | null; error: { status: number; value: unknown } | null }>,
): Promise<T> {
  const { data, error } = await promise
  if (error) throw new Error(`API ${error.status}: ${JSON.stringify(error.value)}`)
  return data as T
}
