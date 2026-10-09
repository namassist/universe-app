/**
 * Integrasi API — the admin's side of the integration tokens.
 *
 * A service is registered here, given its scopes and (optionally) the
 * addresses it may call from, and handed a token **once**: the create
 * response is the only place the token ever appears, since only its hash is
 * kept. Lost means revoked and re-issued, which is the whole recovery story —
 * there is nothing to look up.
 *
 * Revoking stamps rather than deletes, so the list still says who had access
 * and until when, and frees the name for the replacement.
 */

import { and, desc, eq, isNull } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { Elysia, t } from "elysia";
import { INTEGRATION_SCOPES } from "@universe/contracts";

import { requireAuth } from "../auth/macro";
import { db, isUniqueViolation, schema } from "../db";
import { mintToken, normalizeIp } from "../integrations/tokens";
import { localDate } from "../scheduler";
import { ErrorSchema } from "./schemas";

const ic = schema.integrationClients;
const creator = alias(schema.users, "integration_creator");
const revoker = alias(schema.users, "integration_revoker");

const LIVE_NAME_INDEX = "integration_clients_live_name_idx";

const forbidden = { code: "forbidden", message: "Akses ditolak" };
const notFound = { code: "not_found", message: "Klien tidak ditemukan" };
const nameTaken = {
  code: "name_taken",
  message: "Nama ini sudah dipakai klien yang masih aktif",
};
const alreadyRevoked = {
  code: "already_revoked",
  message: "Token ini sudah dicabut",
};

const ClientSchema = t.Object({
  id: t.String(),
  name: t.String(),
  tokenPrefix: t.String(),
  scopes: t.Array(t.String()),
  allowedIps: t.Array(t.String()),
  createdByName: t.String(),
  createdAt: t.String(),
  lastUsedAt: t.Nullable(t.String()),
  /** First day the token works, `YYYY-MM-DD`, site date. */
  validFrom: t.String(),
  /** Last day it works, inclusive; null = never expires. */
  validUntil: t.Nullable(t.String()),
  revokedAt: t.Nullable(t.String()),
  revokedByName: t.Nullable(t.String()),
});

/** A site calendar date, as a date picker sends it. */
const SiteDate = t.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}$" });
const ValidityBody = t.Object({
  validFrom: SiteDate,
  /** Null: the token never expires. */
  validUntil: t.Nullable(SiteDate),
});

/** `2026-02-31` matches the pattern; only a round trip says it is no day. */
const isRealDate = (value: string) =>
  !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) &&
  new Date(`${value}T00:00:00Z`).toISOString().startsWith(value);

/**
 * Why a range cannot be saved, or null when it can. An end already behind
 * today would issue a token that is dead on arrival, which is a mistake, not
 * a choice — a token meant to stop now is revoked.
 */
function rangeRefusal(validFrom: string, validUntil: string | null) {
  if (!isRealDate(validFrom) || (validUntil && !isRealDate(validUntil)))
    return { code: "invalid_date", message: "Tanggal tidak valid" };
  if (validUntil && validUntil < validFrom)
    return {
      code: "invalid_range",
      message: "Tanggal akhir tidak boleh sebelum tanggal mulai",
    };
  if (validUntil && validUntil < localDate(new Date()))
    return {
      code: "already_ended",
      message: "Tanggal akhir sudah lewat — cabut token kalau ingin dihentikan",
    };
  return null;
}

const CreatedSchema = t.Composite([
  ClientSchema,
  t.Object({
    /** The only time it is ever shown. */
    token: t.String(),
  }),
]);

function listed() {
  return db
    .select({
      id: ic.id,
      name: ic.name,
      tokenPrefix: ic.tokenPrefix,
      scopes: ic.scopes,
      allowedIps: ic.allowedIps,
      createdByName: creator.name,
      createdAt: ic.createdAt,
      lastUsedAt: ic.lastUsedAt,
      validFrom: ic.validFrom,
      validUntil: ic.validUntil,
      revokedAt: ic.revokedAt,
      revokedByName: revoker.name,
    })
    .from(ic)
    .innerJoin(creator, eq(creator.id, ic.createdBy))
    .leftJoin(revoker, eq(revoker.id, ic.revokedBy));
}

type ListedRow = Awaited<ReturnType<typeof listed>>[number];

const toClient = (row: ListedRow) => ({
  ...row,
  createdAt: row.createdAt.toISOString(),
  lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
  revokedAt: row.revokedAt?.toISOString() ?? null,
});

async function clientById(id: string) {
  const [row] = await listed().where(eq(ic.id, id)).limit(1);
  return row ? toClient(row) : null;
}

/** A write that matched no live client: revoked (409) or never there (404). */
async function whyNotLive(id: string) {
  return (await clientById(id))
    ? ({ code: 409, body: alreadyRevoked } as const)
    : ({ code: 404, body: notFound } as const);
}

/**
 * Every entry an address, kept in the one spelling the macro compares
 * against (`normalizeIp`), without repeats — or the first that is not one.
 */
function cleanIps(raw: string[]): { ips: string[] } | { bad: string } {
  const ips: string[] = [];
  for (const entry of raw.map((ip) => ip.trim()).filter(Boolean)) {
    const ip = normalizeIp(entry);
    if (!ip) return { bad: entry };
    if (!ips.includes(ip)) ips.push(ip);
  }
  return { ips };
}

export const integrationClientRoutes = new Elysia({
  prefix: "/integration-clients",
  detail: { tags: ["integrations"] },
})
  .use(requireAuth)

  .get(
    "/",
    async () => {
      const rows = await listed().orderBy(desc(ic.createdAt));
      return rows.map(toClient);
    },
    {
      auth: { menu: "integrations", mode: "view" },
      response: {
        200: t.Array(ClientSchema),
        401: ErrorSchema,
        403: ErrorSchema,
      },
      detail: { summary: "List integration clients (never their tokens)" },
    }
  )

  .post(
    "/",
    async ({ body, principal, set, status }) => {
      if (principal.kind !== "user") return status(403, forbidden);

      const name = body.name.trim();
      if (!name)
        return status(422, {
          code: "invalid_name",
          message: "Nama klien wajib diisi",
        });
      const cleaned = cleanIps(body.allowedIps ?? []);
      if ("bad" in cleaned)
        return status(422, {
          code: "invalid_ip",
          message: `"${cleaned.bad}" bukan alamat IP`,
        });
      const validFrom = body.validFrom ?? localDate(new Date());
      const validUntil = body.validUntil ?? null;
      const refusal = rangeRefusal(validFrom, validUntil);
      if (refusal) return status(422, refusal);

      const minted = mintToken();
      try {
        const [row] = await db
          .insert(ic)
          .values({
            name,
            tokenHash: minted.hash,
            tokenPrefix: minted.prefix,
            scopes: [...new Set(body.scopes)],
            allowedIps: cleaned.ips,
            validFrom,
            validUntil,
            createdBy: principal.id,
          })
          .returning({ id: ic.id });
        const client = await clientById(row!.id);
        // The one response that carries a token: no proxy or browser keeps it.
        set.headers["cache-control"] = "no-store";
        return status(201, { ...client!, token: minted.token });
      } catch (error) {
        if (isUniqueViolation(error, LIVE_NAME_INDEX))
          return status(409, nameTaken);
        throw error;
      }
    },
    {
      auth: { menu: "integrations", mode: "manage" },
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 100 }),
        scopes: t.Array(t.UnionEnum(INTEGRATION_SCOPES), { minItems: 1 }),
        allowedIps: t.Optional(t.Array(t.String({ maxLength: 64 }))),
        /** Absent: today. */
        validFrom: t.Optional(SiteDate),
        /** Absent or null: the token never expires. */
        validUntil: t.Optional(t.Nullable(SiteDate)),
      }),
      response: {
        201: CreatedSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Register a service and issue its token (once)" },
    }
  )

  /* New dates, the same token: nothing to hand over again. Brings an
     expired token back too, which is the point of it. */
  .post(
    "/:id/validity",
    async ({ params, body, principal, status }) => {
      if (principal.kind !== "user") return status(403, forbidden);
      const refusal = rangeRefusal(body.validFrom, body.validUntil);
      if (refusal) return status(422, refusal);

      const [extended] = await db
        .update(ic)
        .set({ validFrom: body.validFrom, validUntil: body.validUntil })
        .where(and(eq(ic.id, params.id), isNull(ic.revokedAt)))
        .returning({ id: ic.id });
      if (!extended) {
        const why = await whyNotLive(params.id);
        return status(why.code, why.body);
      }
      return (await clientById(params.id))!;
    },
    {
      auth: { menu: "integrations", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: ValidityBody,
      response: {
        200: ClientSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Change a token's dates (the token stays)" },
    }
  )

  /* A new token for the same client — lost, leaked, or due for a change. The
     old one is dead from the next request; name, scopes and addresses stay,
     and the new token is shown once, as at creation. */
  .post(
    "/:id/rotate",
    async ({ params, body, principal, set, status }) => {
      if (principal.kind !== "user") return status(403, forbidden);
      const refusal = rangeRefusal(body.validFrom, body.validUntil);
      if (refusal) return status(422, refusal);

      const minted = mintToken();
      const [rotated] = await db
        .update(ic)
        .set({
          tokenHash: minted.hash,
          tokenPrefix: minted.prefix,
          validFrom: body.validFrom,
          validUntil: body.validUntil,
          lastUsedAt: null,
        })
        .where(and(eq(ic.id, params.id), isNull(ic.revokedAt)))
        .returning({ id: ic.id });
      if (!rotated) {
        const why = await whyNotLive(params.id);
        return status(why.code, why.body);
      }
      set.headers["cache-control"] = "no-store";
      const client = await clientById(params.id);
      return { ...client!, token: minted.token };
    },
    {
      auth: { menu: "integrations", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      body: ValidityBody,
      response: {
        200: CreatedSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Replace a client's token (shown once)" },
    }
  )

  .post(
    "/:id/revoke",
    async ({ params, principal, status }) => {
      if (principal.kind !== "user") return status(403, forbidden);

      // Conditional, so two admins revoking at once cannot both "succeed".
      const [revoked] = await db
        .update(ic)
        .set({ revokedAt: new Date(), revokedBy: principal.id })
        .where(and(eq(ic.id, params.id), isNull(ic.revokedAt)))
        .returning({ id: ic.id });
      if (!revoked) {
        const why = await whyNotLive(params.id);
        return status(why.code, why.body);
      }
      return (await clientById(params.id))!;
    },
    {
      auth: { menu: "integrations", mode: "manage" },
      params: t.Object({ id: t.String({ format: "uuid" }) }),
      response: {
        200: ClientSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
        409: ErrorSchema,
      },
      detail: { summary: "Revoke a service's token" },
    }
  );
