/**
 * Shared, runtime-light contracts between api / web / mobile.
 *
 * Rule: nothing server-only in here. No db client, no secrets, no node builtins.
 * This package is imported by the browser bundle.
 */

export const API_VERSION = "v1" as const;

export * from "./access";
export * from "./account-import";
export * from "./fleet";
export * from "./fleet-import";
export * from "./master";
export * from "./master-import";
export * from "./roster";
export * from "./session";

/** Shape every non-2xx response from the API uses. */
export type ApiError = {
  code: string;
  message: string;
};
