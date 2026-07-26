import { treaty } from "@elysiajs/eden";

import type { App } from "@universe/api";

/**
 * Eden Treaty over the API's exported type. Type-only, so no server code
 * reaches the browser bundle and there is no codegen step — rename a field in
 * an Elysia route and this app fails to typecheck.
 */
export const API_URL =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

/**
 * Fetch a binary endpoint as a Blob.
 *
 * Deliberately not Eden: Treaty decodes a response body it does not recognise
 * as *text*, so a spreadsheet comes back as a UTF-8-mangled string — every
 * invalid byte sequence replaced with U+FFFD, which no amount of re-encoding
 * recovers. The file downloads, and then refuses to open. Eden is for the typed
 * JSON surface; anything binary goes through fetch.
 */
export async function fetchBlob(path: string): Promise<Blob> {
  const response = await fetch(`${API_URL}${path}`, {
    credentials: "include",
  });
  if (!response.ok) {
    let message = `Request failed (${response.status})`;
    try {
      const body = (await response.json()) as { message?: string };
      if (body.message) message = body.message;
    } catch {
      // Not a JSON error body — the status is all we have.
    }
    throw new Error(message);
  }
  return response.blob();
}

/**
 * Browser client. `credentials: "include"` is what carries the httpOnly
 * session cookie; without it every request is anonymous and 401s.
 */
export const api = treaty<App>(API_URL, {
  fetch: { credentials: "include" },
});

/**
 * Server-side client for Server Components and route handlers. A server fetch
 * has no ambient cookie jar, so the incoming request's cookies are forwarded
 * explicitly — otherwise the server render is anonymous while the browser is
 * signed in.
 */
export async function serverApi() {
  const { cookies } = await import("next/headers");
  const jar = await cookies();
  const header = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
  return treaty<App>(API_URL, {
    headers: header ? { cookie: header } : undefined,
  });
}

export type EdenResult<T> = { data: T | null; error: unknown };

/**
 * Eden returns `{ data, error }`; `queryFn` wants value-or-throw. Throwing the
 * error rather than a stringified copy keeps the status union intact, so
 * `onError` can tell a 401 from a 403.
 */
export async function unwrap<T>(
  promise: Promise<{ data: T | null; error: unknown }>
): Promise<T> {
  const { data, error } = await promise;
  if (error) throw error;
  return data as T;
}

/** True when an Eden error is the given HTTP status. */
export function isStatus(error: unknown, status: number): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: number }).status === status
  );
}

/** The API's error body, when the failure carried one. */
export function errorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const value = (error as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) return null;
  const code = (value as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (typeof error !== "object" || error === null) return fallback;
  const value = (error as { value?: unknown }).value;
  if (typeof value !== "object" || value === null) return fallback;
  const message = (value as { message?: unknown }).message;
  return typeof message === "string" ? message : fallback;
}
