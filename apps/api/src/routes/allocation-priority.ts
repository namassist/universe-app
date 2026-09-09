/**
 * The order the allocation engine fills vacancies in.
 *
 * Until this existed the engine walked its vacancies in unit-code order, which
 * is not a decision about which machine matters — it is an accident of naming.
 * At this site an unlucky one: excavator codes run smallest-first (EX2xxx
 * SMALLDIGGER through EX7xxx BIGDIGGER), so the biggest diggers were reliably
 * crewed last, the exact reverse of the yard's own rule.
 *
 * **The screen is generated, the ranks are stored.** Rows come from the units
 * that actually exist — every distinct (class, SIMPER code) pair among active
 * units — and `allocation_priorities` only supplies each pair's number. So a
 * pair that appears when a new model is imported turns up here on its own,
 * unranked and shown as such, rather than being invisible until somebody
 * remembers to add it. A pair whose last unit is retired stops being offered
 * without anything having to clean up after it.
 *
 * One list across every type, not one per type. The commonest tie of all is
 * between two types — 342 operators here hold both DUMP TRUCK and REAR DUMP
 * TRUCK codes — so a per-type ordering would leave the most frequent question
 * unanswered and fall back to the very unit-code order this replaces.
 */

import { and, eq, sql } from "drizzle-orm";
import { Elysia, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { db, schema } from "../db";
import { ErrorSchema, AllocationPrioritySchema } from "./schemas";

/**
 * Every (class, code) pair the active register actually holds, with its rank.
 *
 * Left-joined from the units rather than selected from the ranks: the units
 * are the fact, the ranks are the opinion about them, and an opinion about a
 * pair nobody owns any more must not keep a line on the screen.
 */
export async function priorityRows() {
  const rows = await db
    .select({
      classId: schema.units.classId,
      className: schema.unitClasses.name,
      simperCodeId: schema.units.simperCodeId,
      simperCodeName: schema.simperCodes.name,
      typeName: schema.unitTypes.name,
      units: sql<number>`count(*)::int`,
      /* Ordered here rather than in the browser: the register's own order is
         what every other unit screen shows, and a list that read differently
         on this one would look like a different set of machines. */
      unitCodes: sql<
        string[]
      >`array_agg(${schema.units.code} order by ${schema.units.code})`,
      rank: sql<number | null>`max(${schema.allocationPriorities.rank})`,
    })
    .from(schema.units)
    .innerJoin(
      schema.unitClasses,
      eq(schema.unitClasses.id, schema.units.classId)
    )
    .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, schema.units.typeId))
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    /* `is not distinct from` rather than `=`: the pair whose code is null is a
       real pair — 18 active units carry no code — and an equality join would
       silently drop its rank on every read. */
    .leftJoin(
      schema.allocationPriorities,
      and(
        eq(schema.allocationPriorities.classId, schema.units.classId),
        sql`${schema.allocationPriorities.simperCodeId} is not distinct from ${schema.units.simperCodeId}`
      )
    )
    .where(eq(schema.units.active, true))
    .groupBy(
      schema.units.classId,
      schema.unitClasses.name,
      schema.units.simperCodeId,
      schema.simperCodes.name,
      schema.unitTypes.name
    );

  /* Ranked first in their given order, then everything nobody has placed —
     grouped by type and named, so an unranked pair reads as a decision waiting
     to be made rather than as one made badly. */
  return rows.sort(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) -
        (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.typeName.localeCompare(b.typeName) ||
      a.className.localeCompare(b.className) ||
      (a.simperCodeName ?? "").localeCompare(b.simperCodeName ?? "")
  );
}

export const allocationPriorityRoutes = new Elysia({
  prefix: "/allocation-priority",
  tags: ["allocation-priority"],
})
  .use(requireAuth)

  .get("/", async () => priorityRows(), {
    auth: { menu: "allocation-priority", mode: "view" },
    response: {
      200: t.Array(AllocationPrioritySchema),
      401: ErrorSchema,
      403: ErrorSchema,
    },
    detail: { summary: "The order vacancies are filled in" },
  })

  .put(
    "/",
    async ({ body, status }) => {
      /* The whole list, every time. A reorder moves one row and renumbers
         everything below it, so sending the order itself is both smaller than
         a diff and impossible to apply half-way. */
      const seen = new Set<string>();
      for (const pair of body.order) {
        const key = `${pair.classId}:${pair.simperCodeId ?? ""}`;
        if (seen.has(key))
          return status(422, {
            code: "duplicate_pair",
            message: "Satu pasangan kelas dan kode simper disebut dua kali",
          });
        seen.add(key);
      }

      await db.transaction(async (tx) => {
        /* Replaced wholesale rather than updated in place: the ranks are one
           ordering, not a set of independent numbers, and a partial write
           would leave two pairs claiming the same position. */
        await tx.delete(schema.allocationPriorities);
        if (body.order.length)
          await tx.insert(schema.allocationPriorities).values(
            body.order.map((pair, index) => ({
              classId: pair.classId,
              simperCodeId: pair.simperCodeId,
              rank: index + 1,
            }))
          );
      });

      return { ranked: body.order.length };
    },
    {
      auth: { menu: "allocation-priority", mode: "manage" },
      body: t.Object({
        order: t.Array(
          t.Object({
            classId: t.String({ format: "uuid" }),
            simperCodeId: t.Nullable(t.String({ format: "uuid" })),
          })
        ),
      }),
      response: {
        200: t.Object({ ranked: t.Integer() }),
        401: ErrorSchema,
        403: ErrorSchema,
        422: ErrorSchema,
      },
      detail: { summary: "Replace the whole priority order" },
    }
  );
