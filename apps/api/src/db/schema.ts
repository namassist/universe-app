import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  time,
  timestamp,
  uniqueIndex,
  uuid,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  ACCESS_MODES,
  AREA_TYPES,
  DEVICE_KINDS,
  SCOPES,
  TIMELINE_ACTIONS,
} from "@universe/contracts";

// Enum values come from contracts so db, API schema, and client cannot drift.
export const scope = pgEnum("scope", SCOPES);
export const accessMode = pgEnum("access_mode", ACCESS_MODES);
export const deviceKind = pgEnum("device_kind", DEVICE_KINDS);
export const areaType = pgEnum("area_type", AREA_TYPES);
export const timelineAction = pgEnum("timeline_action", TIMELINE_ACTIONS);

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

/* ------------------------------------------------------------ catalogues */

/**
 * The columns every master catalogue carries.
 *
 * A function rather than a shared object: `pgTable` binds each builder to the
 * table it is declared in, so handing the same builder instance to nine tables
 * would have them fight over one binding.
 */
function catalogueColumns() {
  return {
    id: uuid("id").primaryKey().defaultRandom(),
    name: text("name").notNull(),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  };
}

/**
 * Case-insensitive uniqueness (design D11). `Hitachi` alongside `HITACHI` is a
 * data-entry accident in every case, and once both exist half the units point
 * at one and half at the other. The index over `lower(name)` is also what the
 * import's lookup reads, so the index that enforces correctness serves the hot
 * path rather than being a second structure to keep aligned.
 */
function lowerNameUnique(prefix: string, name: AnyPgColumn) {
  return uniqueIndex(`${prefix}_name_lower_idx`).on(sql`lower(${name})`);
}

export const unitTypes = pgTable("unit_types", catalogueColumns(), (table) => [
  lowerNameUnique("unit_types", table.name),
]);

export const unitModels = pgTable(
  "unit_models",
  catalogueColumns(),
  (table) => [lowerNameUnique("unit_models", table.name)]
);

export const unitBrands = pgTable(
  "unit_brands",
  catalogueColumns(),
  (table) => [lowerNameUnique("unit_brands", table.name)]
);

export const mess = pgTable("mess", catalogueColumns(), (table) => [
  lowerNameUnique("mess", table.name),
]);

/**
 * `description` defaults to `""` rather than being nullable: the screens render
 * it unconditionally, and "absent" and "empty" mean the same thing here — a
 * nullable column would only add a branch to every consumer.
 */
function describedCatalogueColumns() {
  return {
    ...catalogueColumns(),
    description: text("description").notNull().default(""),
  };
}

export const unitClasses = pgTable(
  "unit_classes",
  describedCatalogueColumns(),
  (table) => [lowerNameUnique("unit_classes", table.name)]
);

/** Permit type — whether a person may operate at all (`F`, `P`). See D4. */
export const simperTypes = pgTable(
  "simper_types",
  describedCatalogueColumns(),
  (table) => [lowerNameUnique("simper_types", table.name)]
);

/**
 * Qualification code — *which* units a person may operate (`EXC 2600`,
 * `OHT 777`). This is what the allocation engine matches a spare against, and
 * what `units.simper_code_id` references. Distinct from `simper_types` (D4).
 */
export const simperCodes = pgTable(
  "simper_codes",
  describedCatalogueColumns(),
  (table) => [lowerNameUnique("simper_codes", table.name)]
);

export const departments = pgTable(
  "departments",
  describedCatalogueColumns(),
  (table) => [lowerNameUnique("departments", table.name)]
);

export const workAreas = pgTable(
  "work_areas",
  {
    ...catalogueColumns(),
    type: areaType("type").notNull(),
  },
  (table) => [lowerNameUnique("work_areas", table.name)]
);

/* ---------------------------------------------------------- unit registry */

/**
 * A unit's class, type, model, brand, qualification code, and department are
 * keys rather than the free text they were in the static port (design D2).
 *
 * `onDelete: "restrict"` throughout, following `users.role_id`: a catalogue row
 * in use cannot be deleted, and the API answers 409 with the referencing count.
 * `SET NULL` would be wrong for the same reason it is wrong for roles — a unit
 * with no class is not a meaningful record.
 *
 * Two references are nullable, and in both cases null is a state rather than
 * missing data. `simper_code_id` is absent on a unit that carries no
 * qualification requirement — a wheel excavator in the sample fleet. And
 * `department_id` is absent on a unit no department owns: a company-wide asset,
 * which is a real category here and not a row someone forgot to finish.
 */
export const units = pgTable(
  "units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    classId: uuid("class_id")
      .notNull()
      .references(() => unitClasses.id, { onDelete: "restrict" }),
    typeId: uuid("type_id")
      .notNull()
      .references(() => unitTypes.id, { onDelete: "restrict" }),
    modelId: uuid("model_id")
      .notNull()
      .references(() => unitModels.id, { onDelete: "restrict" }),
    brandId: uuid("brand_id")
      .notNull()
      .references(() => unitBrands.id, { onDelete: "restrict" }),
    simperCodeId: uuid("simper_code_id").references(() => simperCodes.id, {
      onDelete: "restrict",
    }),
    departmentId: uuid("department_id").references(() => departments.id, {
      onDelete: "restrict",
    }),
    serial: text("serial").notNull().default(""),
    engineBrand: text("engine_brand").notNull().default(""),
    description: text("description").notNull().default(""),
    /** Savera Watch — deliberately separate from `active`. */
    ftw: boolean("ftw").notNull().default(false),
    active: boolean("active").notNull().default(true),
    standby: boolean("standby").notNull().default(false),
    breakdown: boolean("breakdown").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("units_class_id_idx").on(table.classId),
    index("units_type_id_idx").on(table.typeId),
    index("units_brand_id_idx").on(table.brandId),
  ]
);

/**
 * A bus is not an entity — it is a unit of type BUS with a departure time
 * attached (design D6). `unique` on `unit_id` because a bus has one departure
 * time; a second row for the same unit is a 409, not a second schedule.
 */
export const busSchedules = pgTable("bus_schedules", {
  id: uuid("id").primaryKey().defaultRandom(),
  unitId: uuid("unit_id")
    .notNull()
    .unique()
    .references(() => units.id, { onDelete: "restrict" }),
  departAt: time("depart_at").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* --------------------------------------------------------- display content */

/**
 * The master ticker list. `color` is plain text rather than a Postgres enum for
 * the same reason `menu_slug` is: it is validated against `RUNTEXT_COLORS` at
 * the API boundary, so recolouring the palette stays a code change rather than
 * a migration.
 */
export const runTexts = pgTable("run_texts", {
  id: uuid("id").primaryKey().defaultRandom(),
  text: text("text").notNull(),
  color: text("color").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * A device's own texts. Having any at all is what overrides the master list;
 * having none is what falls back to it (design D8) — so these rows carry no
 * `active` flag, because deactivating the last one would be indistinguishable
 * from deleting it and the fallback rule would read two ways.
 */
export const deviceRunTexts = pgTable(
  "device_run_texts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deviceId: text("device_id")
      .notNull()
      .references(() => devices.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    color: text("color").notNull(),
    ord: integer("ord").notNull().default(0),
  },
  (table) => [index("device_run_texts_device_id_idx").on(table.deviceId)]
);

/**
 * Sound metadata. The bytes live on the API's filesystem under `SOUND_DIR` and
 * are streamed with `Bun.file` (design D7); `file_name` is generated by the
 * upload handler, never taken from the client, so a name carrying `../` cannot
 * reach the storage path.
 */
export const sounds = pgTable("sounds", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fileName: text("file_name").notNull(),
  mimeType: text("mime_type").notNull(),
  sizeBytes: integer("size_bytes").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------ allocation schedule */

/**
 * The morning schedule (design D9). `at` is a time of day rather than a
 * timestamp: a stage recurs every day, and storing an instant would make
 * "05:20" a fact about one particular morning.
 */
export const timelineStages = pgTable("timeline_stages", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  at: time("at").notNull(),
  action: timelineAction("action").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type RoleRow = typeof roles.$inferSelect;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;

export type UnitTypeRow = typeof unitTypes.$inferSelect;
export type UnitModelRow = typeof unitModels.$inferSelect;
export type UnitBrandRow = typeof unitBrands.$inferSelect;
export type MessRow = typeof mess.$inferSelect;
export type UnitClassRow = typeof unitClasses.$inferSelect;
export type SimperTypeRow = typeof simperTypes.$inferSelect;
export type SimperCodeRow = typeof simperCodes.$inferSelect;
export type DepartmentRow = typeof departments.$inferSelect;
export type WorkAreaRow = typeof workAreas.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type BusScheduleRow = typeof busSchedules.$inferSelect;
export type RunTextRow = typeof runTexts.$inferSelect;
export type DeviceRunTextRow = typeof deviceRunTexts.$inferSelect;
export type SoundRow = typeof sounds.$inferSelect;
export type TimelineStageRow = typeof timelineStages.$inferSelect;
