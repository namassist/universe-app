/**
 * Shared, runtime-light contracts between api / web / mobile.
 *
 * Rule: nothing server-only in here. No db client, no secrets, no node builtins.
 * This package is imported by the browser bundle.
 */

export const API_VERSION = "v1" as const;

export const USER_ROLES = ["admin", "member"] as const;
export type UserRole = (typeof USER_ROLES)[number];

export type User = {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: string;
};

/** Shape every non-2xx response from the API uses. */
export type ApiError = {
  code: string;
  message: string;
};
