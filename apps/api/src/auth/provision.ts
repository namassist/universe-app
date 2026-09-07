/**
 * An account created by the first login that earns one.
 *
 * Before this, an employee could not log in until an administrator had typed
 * their NIK into the Users screen — the same NIK, into a system that already
 * holds it. The employee register is the authority on who works here, so the
 * register is what login consults: a NIK that belongs to a current employee,
 * presented with the issued default password, earns an account on the spot
 * carrying the default role and nothing else. Administrators are still made by
 * hand; raising a role is the only account work left.
 *
 * What this deliberately does not widen is *who* may log in. An unknown NIK, an
 * employee recorded as having left, or any password other than the issued
 * default still fails — with the same message and the same shape as before, so
 * login still refuses to say which of the three it was.
 */

import { and, eq, inArray } from "drizzle-orm";
import type { EmployeeStatus } from "@universe/contracts";

import { db, isUniqueViolation, schema } from "../db";
import { env } from "../env";
import { hashPassword } from "./password";

/** What a new account starts as. Anything above it is an administrator's act. */
const DEFAULT_ROLE_SLUG = "user";

/**
 * Employed, in whichever posture. Listed positively rather than as "not
 * nonaktif" so that a status added later is denied a login until someone
 * decides it should have one.
 */
const EMPLOYED: EmployeeStatus[] = ["aktif", "standby"];

/**
 * The hash every account is issued, computed once at startup. Login verifies
 * the presented password against this rather than comparing the two strings, so
 * an unregistered NIK costs the same argon2id time as a registered one and the
 * response time stops answering "does this NIK work here".
 */
export const DEFAULT_PASSWORD_HASH = await hashPassword(
  env.DEFAULT_USER_PASSWORD
);

export type ProvisionableEmployee = { nik: string; name: string };

/**
 * The employee an identifier would provision, or null. Employees carry no email
 * address, so this only ever matches a NIK — an email identifier falls through.
 */
export async function provisionableEmployee(
  identifier: string
): Promise<ProvisionableEmployee | null> {
  const [row] = await db
    .select({ nik: schema.employees.nik, name: schema.employees.name })
    .from(schema.employees)
    .where(
      and(
        eq(schema.employees.nik, identifier),
        inArray(schema.employees.status, EMPLOYED)
      )
    )
    .limit(1);
  return row ?? null;
}

/**
 * Create the account and return its id, or null when the installation has no
 * default role to give it — a seed that never ran is a misconfiguration, not a
 * reason to invent a role with unknown permissions.
 *
 * Two logins racing the same first sign-in both reach the insert; the unique
 * NIK settles it, and the loser reads back the winner's row rather than failing
 * a login that was perfectly valid.
 */
export async function provisionUser(
  employee: ProvisionableEmployee
): Promise<string | null> {
  const [role] = await db
    .select({ id: schema.roles.id })
    .from(schema.roles)
    .where(eq(schema.roles.slug, DEFAULT_ROLE_SLUG))
    .limit(1);
  if (!role) {
    console.error(
      `[provision] no "${DEFAULT_ROLE_SLUG}" role — cannot create an account for NIK ${employee.nik}`
    );
    return null;
  }

  try {
    const [row] = await db
      .insert(schema.users)
      .values({
        email: null,
        nik: employee.nik,
        name: employee.name,
        passwordHash: DEFAULT_PASSWORD_HASH,
        // The account is issued a password everyone knows, so it is handed
        // straight to the same gate a hand-made account passes through.
        mustChangePassword: true,
        roleId: role.id,
        active: true,
      })
      .returning({ id: schema.users.id });
    return row?.id ?? null;
  } catch (error) {
    if (!isUniqueViolation(error, "users_nik_unique")) throw error;
    const [existing] = await db
      .select({ id: schema.users.id })
      .from(schema.users)
      .where(eq(schema.users.nik, employee.nik))
      .limit(1);
    return existing?.id ?? null;
  }
}
