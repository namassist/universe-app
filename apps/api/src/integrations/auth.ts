/**
 * The boundary for another service — the integration counterpart of
 * `auth/macro.ts`, deliberately separate from it.
 *
 * Separate because the two must never be confused. The user macro resolves a
 * bearer as a *session id* first, and a known issue already comes from a
 * principal being judged as the wrong kind; here only a token of ours is read
 * (`presentedToken` refuses a session id outright), and a token is never
 * looked for on the user routes. A service holds no role, no menu and no
 * scope over departments — it holds scopes over reads, and that is all it can
 * be granted.
 *
 * Order of refusal: no, unknown or revoked token, or one outside its dates →
 * 401 (the dates with their own codes); a live token without
 * the scope, or from an address it is not allowed → 403; over its budget →
 * 429. Identity before permission, as everywhere else.
 *
 * Every read and every refusal is a line in the server log — the client's
 * name, the path and the address, never the token — so a token that leaks
 * and starts pulling the register shows up as someone else's traffic under
 * that name (security review, 2026-10-09).
 *
 * If Redis is down the budget cannot be read and the request fails with a
 * 500: closed, deliberately, rather than serving without a limit.
 */

import { and, eq, isNull, lt, or } from "drizzle-orm";
import { Elysia } from "elysia";
import type { IntegrationScope } from "@universe/contracts";

import { db, schema } from "../db";
import { env } from "../env";
import { clientIp } from "../ops/client-ip";
import { localDate } from "../scheduler";
import { takeRequest } from "./rate-limit";
import { hashToken, ipAllowed, presentedToken } from "./tokens";

const ic = schema.integrationClients;

/** `last_used_at` is for the screen, not an audit: once a minute is enough. */
const TOUCH_EVERY_MS = 60_000;

const unauthorized = {
  code: "unauthenticated",
  message: "Token integrasi tidak valid",
};
const expired = {
  code: "token_expired",
  message: "Token integrasi sudah kedaluwarsa — minta admin memperpanjang",
};
const notYetValid = {
  code: "token_not_yet_valid",
  message: "Token integrasi belum berlaku — tanggal mulainya belum tiba",
};
const missingScope = {
  code: "forbidden",
  message: "Token ini tidak diberi akses ke data ini",
};
const wrongAddress = {
  code: "ip_not_allowed",
  message: "Alamat ini tidak diizinkan memakai token ini",
};
const rateLimited = {
  code: "rate_limited",
  message: "Terlalu banyak permintaan — coba lagi sebentar",
};

export type IntegrationPrincipal = {
  kind: "integration";
  id: string;
  name: string;
};

function touch(clientId: string, now: Date): void {
  void db
    .update(ic)
    .set({ lastUsedAt: now })
    .where(
      and(
        eq(ic.id, clientId),
        or(
          isNull(ic.lastUsedAt),
          lt(ic.lastUsedAt, new Date(now.getTime() - TOUCH_EVERY_MS))
        )
      )
    )
    .catch((error: unknown) =>
      console.error(
        `[integration] could not stamp last use of ${clientId}:`,
        error instanceof Error ? error.name : error
      )
    );
}

/** Path only: a query string is the caller's, and the log is ours. */
const pathOf = (request: Request) => new URL(request.url).pathname;

function audit(line: string): void {
  console.log(`[integration] ${line}`);
}

export const requireIntegration = new Elysia({
  name: "auth/integration",
}).macro({
  integration(scope: IntegrationScope) {
    return {
      async resolve({ headers, request, server, set, status }) {
        const ip = clientIp(request, server);
        const where = `${request.method} ${pathOf(request)} from ${ip ?? "unknown"}`;
        const token = presentedToken(headers.authorization);
        if (!token) {
          audit(`refused 401 (no token) ${where}`);
          return status(401, unauthorized);
        }

        const [client] = await db
          .select({
            id: ic.id,
            name: ic.name,
            scopes: ic.scopes,
            allowedIps: ic.allowedIps,
            validFrom: ic.validFrom,
            validUntil: ic.validUntil,
          })
          .from(ic)
          .where(and(eq(ic.tokenHash, hashToken(token)), isNull(ic.revokedAt)))
          .limit(1);
        if (!client) {
          audit(`refused 401 (unknown or revoked token) ${where}`);
          return status(401, unauthorized);
        }

        /* Site dates, both ends inclusive, as the muster's schedule reads the
           day (`localDate`). Their own codes, unlike an unknown token: the
           service's operators can tell "ask for an extension" or "not yet"
           from "this token was never ours". `YYYY-MM-DD` compares as text. */
        const today = localDate(new Date());
        if (today < client.validFrom) {
          audit(
            `refused 401 "${client.name}" not valid until ${client.validFrom}: ${where}`
          );
          return status(401, notYetValid);
        }
        if (client.validUntil && today > client.validUntil) {
          audit(
            `refused 401 "${client.name}" expired ${client.validUntil}: ${where}`
          );
          return status(401, expired);
        }

        if (!client.scopes.includes(scope)) {
          audit(`refused 403 "${client.name}" lacks ${scope}: ${where}`);
          return status(403, missingScope);
        }
        if (!ipAllowed(ip, client.allowedIps)) {
          audit(`refused 403 "${client.name}" not allowed ${where}`);
          return status(403, wrongAddress);
        }

        const budget = await takeRequest(
          client.id,
          env.INTEGRATION_RATE_PER_MINUTE
        );
        if (!budget.allowed) {
          audit(`refused 429 "${client.name}" over budget: ${where}`);
          set.headers["retry-after"] = String(budget.retryAfterSeconds);
          return status(429, rateLimited);
        }

        audit(`"${client.name}" ${where}`);
        touch(client.id, new Date());
        const principal: IntegrationPrincipal = {
          kind: "integration",
          id: client.id,
          name: client.name,
        };
        return { integration: principal };
      },
    };
  },
});
