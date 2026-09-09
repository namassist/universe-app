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
 * that actually exist — every distinct description among active units — and
 * `allocation_priorities` only supplies each one's number. So a description
 * that appears when a new machine is imported turns up here on its own,
 * unranked and shown as such, rather than being invisible until somebody
 * remembers to add it. A description whose last unit is retired stops being
 * offered without anything having to clean up after it.
 *
 * One list across every type, not one per type. The commonest tie of all is
 * between two types — 342 operators here hold both DUMP TRUCK and REAR DUMP
 * TRUCK codes — so a per-type ordering would leave the most frequent question
 * unanswered and fall back to the very unit-code order this replaces.
 */

import { eq, sql } from "drizzle-orm";
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
      description: schema.units.description,
      typeName: schema.unitTypes.name,
      units: sql<number>`count(*)::int`,
      /* Distinct and alphabetical throughout: these three describe a group of
         machines, and a value must not repeat once per unit or reorder itself
         between loads. */
      simperCodeNames: sql<
        string[]
      >`coalesce(array_agg(distinct ${schema.simperCodes.name}) filter (where ${schema.simperCodes.name} is not null), '{}')`,
      brandNames: sql<string[]>`array_agg(distinct ${schema.unitBrands.name})`,
      unitCodes: sql<
        string[]
      >`array_agg(${schema.units.code} order by ${schema.units.code})`,
      rank: sql<number | null>`max(${schema.allocationPriorities.rank})`,
    })
    .from(schema.units)
    .innerJoin(schema.unitTypes, eq(schema.unitTypes.id, schema.units.typeId))
    .innerJoin(
      schema.unitBrands,
      eq(schema.unitBrands.id, schema.units.brandId)
    )
    .leftJoin(
      schema.simperCodes,
      eq(schema.simperCodes.id, schema.units.simperCodeId)
    )
    .leftJoin(
      schema.allocationPriorities,
      eq(schema.allocationPriorities.description, schema.units.description)
    )
    .where(eq(schema.units.active, true))
    /* By description *and* type, though the type is not part of the key: no
       description here spans two types, and grouping by both lets the heading
       be selected without a second query. A file that ever broke that would
       split the row rather than pick a type at random, which is the failure
       worth having. */
    .groupBy(schema.units.description, schema.unitTypes.name);

  /* Ranked first in their given order, then everything nobody has placed —
     named, so an unranked line reads as a decision waiting to be made rather
     than as one made badly. */
  return rows.sort(
    (a, b) =>
      (a.rank ?? Number.MAX_SAFE_INTEGER) -
        (b.rank ?? Number.MAX_SAFE_INTEGER) ||
      a.typeName.localeCompare(b.typeName) ||
      a.description.localeCompare(b.description)
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
      for (const entry of body.order) {
        if (seen.has(entry.description))
          return status(422, {
            code: "duplicate_description",
            message: "Satu deskripsi unit disebut dua kali",
          });
        seen.add(entry.description);
      }

      await db.transaction(async (tx) => {
        /* Replaced wholesale rather than updated in place: the ranks are one
           ordering, not a set of independent numbers, and a partial write
           would leave two pairs claiming the same position. */
        await tx.delete(schema.allocationPriorities);
        if (body.order.length)
          await tx.insert(schema.allocationPriorities).values(
            body.order.map((entry, index) => ({
              description: entry.description,
              rank: index + 1,
            }))
          );
      });

      return { ranked: body.order.length };
    },
    {
      auth: { menu: "allocation-priority", mode: "manage" },
      body: t.Object({
        order: t.Array(t.Object({ description: t.String() })),
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
