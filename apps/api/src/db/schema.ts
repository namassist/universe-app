import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { ACCESS_MODES, DEVICE_KINDS, SCOPES } from "@universe/contracts";

// Enum values come from contracts so db, API schema, and client cannot drift.
export const scope = pgEnum("scope", SCOPES);
export const accessMode = pgEnum("access_mode", ACCESS_MODES);
export const deviceKind = pgEnum("device_kind", DEVICE_KINDS);

/**
 * Roles are runtime data — the User Management screen creates, edits, and
 * deletes them. `locked` marks the bootstrap superadmin role, which must
 * survive any amount of misconfiguration.
 */
export const roles = pgTable("roles", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  scope: scope("scope").notNull(),
  locked: boolean("locked").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A grant of a mode on a menu. Absence of a row means no access — `none` is
 * never stored. `menu_slug` is plain text rather than a Postgres enum: it is
 * validated against MENU_SLUGS at the API boundary, so adding a menu stays a
 * code change plus a seed rather than a migration.
 */
export const rolePermissions = pgTable(
  "role_permissions",
  {
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "cascade" }),
    menuSlug: text("menu_slug").notNull(),
    mode: accessMode("mode").notNull(),
  },
  (table) => [primaryKey({ columns: [table.roleId, table.menuSlug] })]
);

/**
 * Accounts authenticate by email or NIK — office staff have one, field
 * operators the other, some both. There is deliberately no `departemen`
 * column: departemen belongs to the employee record, and a `dept`-scoped
 * caller resolves through `users.nik → employees.nik → employees.dept`.
 */
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").unique(),
    nik: text("nik").unique(),
    name: text("name").notNull(),
    passwordHash: text("password_hash").notNull(),
    mustChangePassword: boolean("must_change_password").notNull().default(true),
    roleId: uuid("role_id")
      .notNull()
      .references(() => roles.id, { onDelete: "restrict" }),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    check(
      "users_email_or_nik",
      sql`${table.email} is not null or ${table.nik} is not null`
    ),
    index("users_role_id_idx").on(table.roleId),
  ]
);

/**
 * A display device is a principal, not a user: no role, no scope, no NIK, no
 * password. Its authorization is fixed in code — read-only, /display/* only.
 * `id` is the human-assigned tag ("DSP-A01") the registry already used.
 */
export const devices = pgTable("devices", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  kind: deviceKind("kind").notNull(),
  active: boolean("active").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RoleRow = typeof roles.$inferSelect;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
