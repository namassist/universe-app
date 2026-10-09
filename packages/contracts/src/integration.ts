/**
 * The integration API's vocabulary — what another service on the site network
 * may be allowed to read.
 *
 * A scope names one read, not a menu: a service holds no role and sees no
 * screen, so the menu grants that govern people would be the wrong unit. One
 * scope today; a service that later needs, say, the roster gets a second
 * scope and the same token mechanism, not a new one.
 */

export const INTEGRATION_SCOPES = ["employees:read"] as const;
export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

/**
 * What each scope opens, as the endpoints themselves (owner, 2026-10-09:
 * the path says more to whoever wires the service than a description does).
 * Relative to `/v1/integrations`.
 */
export const INTEGRATION_SCOPE_ENDPOINTS: Record<IntegrationScope, string[]> = {
  "employees:read": [
    "GET /employees",
    "GET /employees/{nik}",
    "GET /employees/{nik}/photo",
  ],
};

/** Type guard for a value arriving from the wire. */
export function isIntegrationScope(value: string): value is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(value);
}

/**
 * Every token starts with this, so one pasted into a chat or a log is
 * recognisable for what it is — and a secret scanner can be taught the prefix.
 */
export const INTEGRATION_TOKEN_PREFIX = "uvk_";
