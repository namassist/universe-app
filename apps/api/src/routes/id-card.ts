/**
 * The ID card scan: one person, by the NIK their card carries.
 *
 * Read at a gate from a phone — scan the barcode, see who this is and what the
 * muster gave them today: department and position, the machines they may be
 * given, the unit the board seated them on, where it waits, and whether they
 * have tapped in yet.
 *
 * **Scoped like every other read of the register** (owner, 2026-09-20). A
 * `dept` role resolves its own department and nobody else, and a card it may
 * not see is the same 404 as a NIK that does not exist — which is which is not
 * a screen's business. Devices never reach here at all: a kiosk that resolved
 * any NIK would be a way to walk the register, which is exactly what the
 * display routes were shaped to prevent.
 *
 * It reads and records nothing: scanning a card is looking, not an event.
 */

import { and, eq } from "drizzle-orm";
import { Elysia, file as elysiaFile, t } from "elysia";

import { requireAuth } from "../auth/macro";
import { scopeWhere } from "../auth/scope";
import { currentShift } from "../current-shift";
import { db, schema } from "../db";
import { cardSeat, simperCodes } from "../id-card";
import { rosterDayInForce } from "../roster-in-force";
import { normalizeNik } from "../sources/nik";
import { spareRideOf } from "../spare-ride";
import { shiftGates } from "../stage-time";
import { photoMimeType, photoPath } from "../storage";
import { firstTapOf, seatOf } from "../ticket-issue";
import { ErrorSchema, IdCardSchema } from "./schemas";

const notFound = {
  code: "employee_not_found",
  message: "Kartu tidak dikenali",
};

const photoNotFound = {
  code: "photo_not_found",
  message: "Foto tidak ditemukan",
};

/**
 * The person a scanned card names, if this reader may see them.
 *
 * One query, scope included, so a card outside the caller's department is
 * indistinguishable from a card nobody holds.
 */
async function personOf(
  principal: Parameters<typeof scopeWhere>[0],
  nik: string
) {
  const [person] = await db
    .select({
      id: schema.employees.id,
      nik: schema.employees.nik,
      name: schema.employees.name,
      photoFile: schema.employees.photoFileName,
      status: schema.employees.status,
      department: schema.departments.name,
      position: schema.positions.name,
      simperNo: schema.employees.simperNo,
      simperTypeName: schema.simperTypes.name,
      simperExp: schema.employees.simperExp,
      /* Whether allocation is about this person at all — what decides
         between SPARE and nothing when they hold no unit. */
      fleetAllocation: schema.positions.fleetAllocation,
    })
    .from(schema.employees)
    .leftJoin(
      schema.departments,
      eq(schema.departments.id, schema.employees.departmentId)
    )
    .leftJoin(
      schema.positions,
      eq(schema.positions.id, schema.employees.positionId)
    )
    .leftJoin(
      schema.simperTypes,
      eq(schema.simperTypes.id, schema.employees.simperTypeId)
    )
    .where(
      and(
        eq(schema.employees.nik, nik),
        await scopeWhere(principal, {
          dept: schema.employees.departmentId,
          self: schema.employees.nik,
        })
      )
    )
    .limit(1);
  return person ?? null;
}

/**
 * Where the phone fetches the face from, or null when none is on file.
 *
 * A ready path rather than a file name to assemble: the Kotlin client should
 * not know how this API lays out its routes. The file name rides along as
 * `?v=` so a replaced photo is a new URL and never comes back out of cache.
 */
const photoUrlOf = (nik: string, photoFile: string | null) =>
  photoFile
    ? `/v1/id-card/${encodeURIComponent(nik)}/photo?v=${encodeURIComponent(photoFile)}`
    : null;

export const idCardRoutes = new Elysia({
  prefix: "/id-card",
  tags: ["employees"],
})
  .use(requireAuth)
  .get(
    "/:nik",
    async ({ params, principal, status }) => {
      /* The barcode is the card's own printing — a prefix, leading zeros —
         and the register holds the plain number. The same recipe every other
         source is matched by. */
      const nik = normalizeNik(params.nik);
      const person = await personOf(principal, nik);
      if (!person) return status(404, notFound);

      const skills = await db
        .select({ name: schema.simperCodes.name })
        .from(schema.employeeSkills)
        .innerJoin(
          schema.simperCodes,
          eq(schema.simperCodes.id, schema.employeeSkills.simperCodeId)
        )
        .where(eq(schema.employeeSkills.employeeId, person.id))
        .orderBy(schema.simperCodes.name);

      /* Who the card names, whatever today holds. The SIMPER card is read
         as the Profil screen reads it: an empty number is null, not "". */
      const card = {
        nik: person.nik,
        name: person.name,
        photoFile: person.photoFile,
        photoUrl: photoUrlOf(person.nik, person.photoFile),
        department: person.department,
        position: person.position,
        simper: simperCodes(skills),
        simperNo: person.simperNo || null,
        simperTypeName: person.simperTypeName,
        simperExp: person.simperExp,
      };

      /* The shift the site is working now, the same boundary the walls turn
         on. With a half-configured timeline there is no answer, and the card
         says so by leaving today's half empty rather than guessing it. */
      const now = currentShift(new Date(), await shiftGates());
      if (!now)
        return {
          ...card,
          shift: null,
          roster: null,
          unit: null,
          area: null,
          bus: null,
          checkInAt: null,
        };

      const [roster, seat, checkInAt] = await Promise.all([
        db
          .select({ code: schema.rosterDays.code })
          .from(schema.rosterDays)
          .where(
            and(
              eq(schema.rosterDays.employeeId, person.id),
              eq(schema.rosterDays.date, now.date),
              rosterDayInForce
            )
          )
          .limit(1),
        seatOf(person.nik, now.date, now.shift),
        firstTapOf(person.nik, now.date, now.shift),
      ]);

      /* `=== true` because the join is a left one: a person whose position
         row is missing reads null, which is not "allocation is about him". */
      const spareEligible =
        person.status === "aktif" && person.fleetAllocation === true;
      const seated = cardSeat({
        seat: seat?.seat ?? null,
        spareEligible,
        /* Only asked for when it can be shown: the pool's ride is a fact
           about the shift, not about this person. */
        ride:
          seat?.seat || !spareEligible
            ? null
            : await spareRideOf(now.date, now.shift),
      });

      return {
        ...card,
        shift: now.shift,
        roster: roster[0]?.code ?? null,
        ...seated,
        checkInAt: checkInAt ? checkInAt.slice(11, 19) : null,
      };
    },
    {
      auth: { menu: "scan-id", mode: "view" },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      response: {
        200: IdCardSchema,
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "The person a scanned ID card names" },
    }
  )

  /**
   * The face on the card, for the same readers and under the same scope.
   *
   * Its own route rather than `/employees/:nik/photo` because this screen is
   * granted on its own: a Manajer who may scan a card does not thereby hold
   * the employee register, and widening that route would have given it to him.
   */
  .get(
    "/:nik/photo",
    async ({ params, principal, set, status }) => {
      const person = await personOf(principal, normalizeNik(params.nik));
      if (!person?.photoFile) return status(404, photoNotFound);

      const path = photoPath(person.photoFile);
      // The row can outlive the file (design D8) — a 404 the screen falls
      // back from, not a 500.
      if (!(await Bun.file(path).exists())) return status(404, photoNotFound);
      set.headers["content-type"] = photoMimeType(person.photoFile);
      return elysiaFile(path);
    },
    {
      auth: { menu: "scan-id", mode: "view" },
      params: t.Object({ nik: t.String({ minLength: 1 }) }),
      /* The 200 is the image itself, declared as `t.File` so the phone's
         generated client reads it as binary (the mobile spec files it under
         `image/*`). */
      response: {
        200: t.File({
          description: "The photo, as stored (JPEG, PNG or WebP)",
        }),
        401: ErrorSchema,
        403: ErrorSchema,
        404: ErrorSchema,
      },
      detail: { summary: "A scanned card's photo" },
    }
  );
