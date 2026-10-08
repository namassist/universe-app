/**
 * The Operations Center: one read-only page about whether the application is
 * healthy and whether this shift's muster is running.
 *
 * It is reached with its own password rather than an account, so it sits
 * outside roles and menus entirely — the payload types come from the route's
 * own schema through Eden, and only the constants both sides must agree on
 * live here.
 */

/** How far back the request charts and per-route figures reach, in minutes. */
export const OPS_WINDOW_MINUTES = 60;

/** How often the page asks again, in milliseconds. */
export const OPS_POLL_MS = 15_000;
