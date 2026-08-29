import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
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
  BLOOD_TYPES,
  DEVICE_KINDS,
  EMPLOYEE_STATUSES,
  MCU_RESULTS,
  ROSTER_CODES,
  ROSTER_DOCUMENT_STATUSES,
  ROSTER_REVISION_STATUSES,
  SCOPES,
  SHIFT_KINDS,
  TIMELINE_ACTIONS,
  UNIT_STATUSES,
} from "@universe/contracts";

// Enum values come from contracts so db, API schema, and client cannot drift.
export const scope = pgEnum("scope", SCOPES);
export const accessMode = pgEnum("access_mode", ACCESS_MODES);
export const deviceKind = pgEnum("device_kind", DEVICE_KINDS);
export const areaType = pgEnum("area_type", AREA_TYPES);
export const timelineAction = pgEnum("timeline_action", TIMELINE_ACTIONS);
export const shiftKind = pgEnum("shift_kind", SHIFT_KINDS);
export const employeeStatus = pgEnum("employee_status", EMPLOYEE_STATUSES);
export const mcuResult = pgEnum("mcu_result", MCU_RESULTS);
export const bloodType = pgEnum("blood_type", BLOOD_TYPES);
export const unitStatus = pgEnum("unit_status", UNIT_STATUSES);
export const rosterCode = pgEnum("roster_code", ROSTER_CODES);
export const rosterDocumentStatus = pgEnum(
  "roster_document_status",
  ROSTER_DOCUMENT_STATUSES
);
export const rosterRevisionStatus = pgEnum(
  "roster_revision_status",
  ROSTER_REVISION_STATUSES
);

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
 * caller resolves through `users.nik → employees.nik → employees.department_id`.
 *
 * `nik` still carries **no** foreign key to `employees`, and that is a decision
 * rather than an omission (auth D5, employee D2). The two records have
 * different lifetimes: deleting an employee must not delete the account, and
 * the employee route refuses that deletion instead. The rule that a NIK must
 * name an employee is enforced at the API boundary — in the account routes and
 * in the account import both — where it can be relaxed per route if an account
 * that is not a person is ever needed.
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

/**
 * The fingerprint machines on site — the registry the monitoring TV reads.
 *
 * Not a `catalogueColumns()` catalogue: a catalogue row is a name, and this is
 * a name plus the address the prober talks to. It is also deliberately not a
 * read of Nakula's `tbl_m_absen_to_finger`, which holds rows for machines dead
 * since early 2026 — this table is owned here and edited here.
 *
 * `ip` is unique because it is the machine's identity for probing: two rows
 * with one address would be probed twice and reported as two machines. The
 * constraint is what makes a duplicate a 409 instead of a silent second card
 * on the wall.
 *
 * The reachability columns are written only by the prober (`prober.ts`) and
 * read by everything else; no request path ever opens a socket to a machine.
 */
export const fingerprintMachines = pgTable("fingerprint_machines", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  ip: text("ip").notNull().unique(),
  active: boolean("active").notNull().default(true),
  /* ---- written by the prober, read by the wall ---- */
  /** Last probe verdict, after the miss-count debounce. */
  online: boolean("online").notNull().default(false),
  /** Last probe that actually reached the machine. */
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  /** Last probe attempt, reachable or not — the freshness of `online`. */
  checkedAt: timestamp("checked_at", { withTimezone: true }),
  /**
   * When the current `online` value began. Moves only on a transition, never
   * on an unchanged cycle — otherwise "offline for 2 h" resets every minute
   * and the wall can never show how long a machine has been down.
   */
  statusSince: timestamp("status_since", { withTimezone: true }),
  /**
   * Consecutive failed probes. Persisted rather than held in memory so a
   * process restart cannot silently walk a machine back to online; the flip
   * happens only once this reaches the configured threshold, which is what
   * keeps one dropped packet off a wall-mounted TV.
   */
  missCount: integer("miss_count").notNull().default(0),
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

/**
 * A department belongs to exactly one company, and a position to exactly one
 * department.
 *
 * All three were flat catalogues until the two companies turned out to run
 * different departments and every department to need its own `ADMIN`. Both
 * facts are unrepresentable in a flat list: with one global name index there
 * can be exactly one `ADMIN` and exactly one `MINING OPERATION` in the whole
 * installation, and whichever company or department claimed the name first owns
 * it. The parent key is what makes "the same name under a different parent" a
 * different row.
 *
 * Which is also why the uniqueness moved rather than merely gaining a column:
 * it is `(parent, lower(name))` now, so `UDU / HRM` and `RBS / HRM` coexist and
 * a second `HRM` under the same company is still refused.
 *
 * `restrict` on both, following every other reference here: a company with
 * departments and a department with positions cannot be deleted out from under
 * them, and the master route answers 409 naming what is holding the row.
 *
 * `employees` keeps its own `company_id` even though the department already
 * implies one. The pairing is checked in the route rather than by the schema —
 * a composite foreign key would force `departments` to carry a redundant unique
 * key on `(id, company_id)` for the sake of a constraint the route can state
 * more clearly, and state in the same message as every other validation.
 */
export const departments = pgTable(
  "departments",
  {
    ...describedCatalogueColumns(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
  },
  (table) => [
    uniqueIndex("departments_company_name_lower_idx").on(
      table.companyId,
      sql`lower(${table.name})`
    ),
    index("departments_company_id_idx").on(table.companyId),
  ]
);

export const workAreas = pgTable(
  "work_areas",
  {
    ...catalogueColumns(),
    type: areaType("type").notNull(),
  },
  (table) => [lowerNameUnique("work_areas", table.name)]
);

/**
 * The employing company, and the job title (design D5).
 *
 * Both were free-ish text before: company was two hardcoded `<option>`s and
 * position was an open `<Input>` whose value is used to filter. `PT UDU` beside
 * `PT Unggul Dinamika Utama` is a typing accident in every case, and once both
 * exist half the workforce points at one and half at the other. Described
 * catalogues, like `departemen`, rather than a fourth shape.
 */
/**
 * `code` is the short form the site actually speaks in — UDU, RBS. It is a
 * second identity for the same row rather than decoration, so it is unique and
 * required: a company whose code is blank cannot be referred to the way people
 * refer to it, and two companies sharing one code is the ambiguity the code
 * exists to remove.
 */
export const companies = pgTable(
  "companies",
  {
    ...describedCatalogueColumns(),
    code: text("code").notNull(),
  },
  (table) => [
    lowerNameUnique("companies", table.name),
    uniqueIndex("companies_code_lower_idx").on(sql`lower(${table.code})`),
  ]
);

export const positions = pgTable(
  "positions",
  {
    ...describedCatalogueColumns(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    /**
     * Whether someone holding this position is allocated a unit.
     *
     * A property of the *position*, not of the person: whether an operator is
     * in today's allocation is a roster question, but whether a payroll officer
     * could ever be is a question about the job. Keeping it here is what lets
     * the allocation engine ask for candidates without enumerating job titles
     * it would have to be taught again every time one is added.
     *
     * Defaults to false, which is the safe direction: a position nobody has
     * classified yet is left out of allocation rather than silently offered a
     * dump truck.
     */
    fleetAllocation: boolean("fleet_allocation").notNull().default(false),
  },
  (table) => [
    uniqueIndex("positions_department_name_lower_idx").on(
      table.departmentId,
      sql`lower(${table.name})`
    ),
    index("positions_department_id_idx").on(table.departmentId),
  ]
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

/* -------------------------------------------------------------------- fleets */

/**
 * A fleet is a digger and the haulers that serve it, parked at a work area.
 *
 * The digger is a reference to a unit rather than a fleet attribute, and it is
 * `unique`: a digger leads at most one fleet, and "which fleet" is a property
 * of the digger rather than a name someone maintains. The fleet has no name
 * column for the same reason — every screen calls it "Fleet EX8001".
 *
 * `work_area_id` is `notNull`: a fleet exists to work somewhere, and the route
 * additionally requires the area to be of type Mining. `bus_unit_id` is
 * nullable — a fleet without a crew bus is a real state, not missing data —
 * and the route requires the unit it names to be of type BUS.
 *
 * `onDelete: "restrict"` on every unit reference, following the rest of the
 * schema: deleting a unit that leads a fleet, rides as its bus, or hauls in it
 * is refused with a count, not silently unlinked.
 */
export const fleets = pgTable("fleets", {
  id: uuid("id").primaryKey().defaultRandom(),
  diggerUnitId: uuid("digger_unit_id")
    .notNull()
    .unique()
    .references(() => units.id, { onDelete: "restrict" }),
  workAreaId: uuid("work_area_id")
    .notNull()
    .references(() => workAreas.id, { onDelete: "restrict" }),
  busUnitId: uuid("bus_unit_id").references(() => units.id, {
    onDelete: "restrict",
  }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/**
 * The haulers of one fleet, one row per unit.
 *
 * `unit_id` is `unique` across the whole table, not per fleet: a unit hauls
 * for at most one fleet, and the exclusivity the screen promises ("units of
 * other fleets are hidden") is a fact the database holds rather than a filter
 * the client applies. The digger is deliberately *not* a member row — the
 * route refuses a digger offered as a member, and membership rows die with
 * their fleet (`cascade`) because they are the fleet's edge list, not records
 * in their own right.
 */
export const fleetUnits = pgTable(
  "fleet_units",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    fleetId: uuid("fleet_id")
      .notNull()
      .references(() => fleets.id, { onDelete: "cascade" }),
    unitId: uuid("unit_id")
      .notNull()
      .unique()
      .references(() => units.id, { onDelete: "restrict" }),
  },
  (table) => [index("fleet_units_fleet_id_idx").on(table.fleetId)]
);

/**
 * The standing PLAN pairings — which operators hold which unit, across
 * shifts.
 *
 * At most two operators per unit (one Day, one Night — the route enforces
 * both the count and the opposite-shift rule, which need the roster and so
 * cannot live here). What the table *does* hold: `unique(employee_id)` — an
 * operator holds at most one unit, which is what makes "busy at RD5001" a
 * fact rather than a filter — and `unique(unit_id, employee_id)` against the
 * same pairing twice. `restrict` on both sides: deleting a planned unit or a
 * paired operator is refused with a count, the same as every reference here.
 */
export const fleetPlanSlots = pgTable(
  "fleet_plan_slots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    employeeId: uuid("employee_id")
      .notNull()
      .unique()
      .references(() => employees.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("fleet_plan_slots_unit_employee_idx").on(
      table.unitId,
      table.employeeId
    ),
    index("fleet_plan_slots_unit_id_idx").on(table.unitId),
  ]
);

/**
 * Every status change a unit has been through, newest first on read.
 *
 * The unit's *current* status stays derived from the two flags on `units` —
 * this table is the answer to "since when, and why", which the flags cannot
 * hold. `reason` is `notNull` because the route refuses a change without one:
 * a breakdown with no stated cause is a row the morning meeting cannot act
 * on. Append-only by convention — nothing updates or deletes a history row.
 */
export const unitStatusHistory = pgTable(
  "unit_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    unitId: uuid("unit_id")
      .notNull()
      .references(() => units.id, { onDelete: "restrict" }),
    status: unitStatus("status").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("unit_status_history_unit_created_idx").on(
      table.unitId,
      table.createdAt
    ),
  ]
);

/* ----------------------------------------------------------------- workforce */

/**
 * One wide table for a person, and one join table for what they may operate
 * (design D1).
 *
 * Identity, employment, SIMPER, medical, mess, and contact all live here.
 * Splitting them into `employee_medical`, `employee_contacts`, and
 * `employee_housing` would yield three tables that are one-to-one, never null,
 * never two, and read together on every screen — which is a column, not a
 * relation. `units` set the precedent: one wide table with six foreign keys.
 *
 * `id` is a uuid and `nik` is the business key (D2). NIK is issued by people
 * and occasionally corrected; as a primary key a one-digit correction would
 * cascade into every table that points at an employee — and those tables
 * (roster, attendance, FTW) do not exist yet, which is exactly why the decision
 * is cheap to make now.
 *
 * `mess_id` and `simper_type_id` are nullable because both absences are real
 * states: an employee may live off site, and one who operates nothing holds no
 * permit. Everything else is `onDelete: "restrict"`, following `units` — a
 * catalogue row in use cannot be deleted, and the API answers 409 with the
 * count.
 */
export const employees = pgTable(
  "employees",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    nik: text("nik").notNull().unique(),
    name: text("name").notNull(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    positionId: uuid("position_id")
      .notNull()
      .references(() => positions.id, { onDelete: "restrict" }),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    messId: uuid("mess_id").references(() => mess.id, { onDelete: "restrict" }),
    /** Permit *type* (`F`, `P`) — distinct from the qualification codes below. */
    simperTypeId: uuid("simper_type_id").references(() => simperTypes.id, {
      onDelete: "restrict",
    }),
    joinDate: date("join_date"),
    license: text("license").notNull().default(""),
    simperNo: text("simper_no").notNull().default(""),
    simperExp: date("simper_exp"),
    /* The value in force, with no history (design D3): renewing a SIMPER or an
       MCU overwrites, because "is it valid today" is the only question either
       the screens or the allocation engine ask. */
    mcu: mcuResult("mcu"),
    mcuExp: date("mcu_exp"),
    blood: bloodType("blood"),
    medical: text("medical").notNull().default(""),
    block: text("block").notNull().default(""),
    room: text("room").notNull().default(""),
    phone: text("phone").notNull().default(""),
    emergency: text("emergency").notNull().default(""),
    /** Generated by the upload handler; the bytes live under `PHOTO_DIR` (D8). */
    photoFileName: text("photo_file_name"),
    status: employeeStatus("status").notNull().default("aktif"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    // The three the list filters and the scope predicate read, following the
    // shape of the indexes on `units`.
    index("employees_department_id_idx").on(table.departmentId),
    index("employees_company_id_idx").on(table.companyId),
    index("employees_position_id_idx").on(table.positionId),
  ]
);

/**
 * Which units a person may operate (design D4).
 *
 * The static port kept these as an array of strings while `units.simper_code_id`
 * was already a uuid, so matching the two meant comparing a name with a key —
 * and a mistyped code produced no error at all, only a spare who never matches
 * any unit. The symptom is an idle machine at the start of a shift, which is
 * precisely the failure this product exists to prevent.
 *
 * Composite primary key rather than an `id` of its own: a second row for the
 * same pair means nothing, and refusing it in the schema is cheaper than
 * refusing it in every writer. `cascade` to the employee because the assignment
 * is part of the person's record; `restrict` to the catalogue, like everywhere
 * else.
 */
export const employeeSkills = pgTable(
  "employee_skills",
  {
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    simperCodeId: uuid("simper_code_id")
      .notNull()
      .references(() => simperCodes.id, { onDelete: "restrict" }),
  },
  (table) => [
    primaryKey({ columns: [table.employeeId, table.simperCodeId] }),
    index("employee_skills_simper_code_id_idx").on(table.simperCodeId),
  ]
);

/* --------------------------------------------------------------- roster */

/**
 * One monthly upload for one department (design D4).
 *
 * `month` is a date pinned to the first of the month rather than a `YYYY-MM`
 * string: it is compared against `roster_days.date` on every revision, and a
 * comparison between a date and a text month is a comparison that works until
 * someone writes `2026-7`.
 *
 * `uploaded_by` is `restrict` like every other reference in this schema — an
 * account that uploaded a roster is part of the document's provenance, and
 * provenance that can be deleted is provenance that cannot be trusted.
 */
export const rosterDocuments = pgTable(
  "roster_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    departmentId: uuid("department_id")
      .notNull()
      .references(() => departments.id, { onDelete: "restrict" }),
    /** Always the first day of the month the document covers. */
    month: date("month").notNull(),
    fileName: text("file_name").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    status: rosterDocumentStatus("status").notNull().default("aktif"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    /**
     * One department, one month, one document in force (design D5).
     *
     * Partial rather than total, because the archived documents of the same
     * month are exactly what re-uploading produces — the rule is about which
     * one is *active*, and stating it any other way would forbid the history.
     */
    uniqueIndex("roster_documents_active_month_idx")
      .on(table.departmentId, table.month)
      .where(sql`${table.status} = 'aktif'`),
    index("roster_documents_department_id_idx").on(table.departmentId),
  ]
);

/**
 * One code, for one person, on one day — owned by the document that carried it.
 *
 * Ownership rather than a flat `(employee_id, date)` table (design D4): the
 * detail screen renders an *archived* document's grid, and on a flat table a
 * re-upload would move those rows to the new document and leave the old one
 * rendering as empty — indistinguishable from a broken screen.
 *
 * No unit column, no spare flag, and no knowledge that PLAN exists (D3). A
 * spare is rostered `D` or `N` like anyone else; being a spare is a property of
 * holding no unit, and that is resolved a layer up.
 *
 * `restrict` to the employee is what makes a roster day a trace that refuses
 * the employee's deletion (D14) — enforced by the database, not promised by a
 * route.
 */
export const rosterDays = pgTable(
  "roster_days",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => rosterDocuments.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    code: rosterCode("code").notNull(),
  },
  (table) => [
    uniqueIndex("roster_days_document_employee_date_idx").on(
      table.documentId,
      table.employeeId,
      table.date
    ),
    /** The morning question: who is `D` (or `N`) on this date (design D15). */
    index("roster_days_date_code_idx").on(table.date, table.code),
    /** Revisions and one person's history. */
    index("roster_days_employee_date_idx").on(table.employeeId, table.date),
  ]
);

/**
 * A submission: one operator, one moment, N entries (design D10).
 *
 * `code` is the readable identifier (`REV-0001`) the screens show, generated
 * server-side and unique. It belongs to a document, so archiving the document
 * freezes the submission with it (D12) — there is no revision floating free of
 * the roster it revises.
 */
export const rosterRevisions = pgTable(
  "roster_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    code: text("code").notNull().unique(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => rosterDocuments.id, { onDelete: "cascade" }),
    submittedBy: uuid("submitted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    submittedAt: timestamp("submitted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [index("roster_revisions_document_id_idx").on(table.documentId)]
);

/**
 * One requested change, decided on its own (design D10).
 *
 * `from_code` is stored rather than resolved at decision time: an entry that
 * waited two days would otherwise approve a change away from a code that was
 * never the one submitted, and the history would read as a lie. When it no
 * longer matches what is in force, that is a conflict to report — not a value
 * to overwrite.
 *
 * `start_time`/`end_time` live here and nowhere else. The revision form offers
 * them as an optional pair; an ordinary roster day has no hours, and two
 * always-null columns on a table that grows by 62,000 rows a month is not a
 * trade worth making.
 */
export const rosterRevisionItems = pgTable(
  "roster_revision_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    revisionId: uuid("revision_id")
      .notNull()
      .references(() => rosterRevisions.id, { onDelete: "cascade" }),
    employeeId: uuid("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "restrict" }),
    date: date("date").notNull(),
    fromCode: rosterCode("from_code").notNull(),
    toCode: rosterCode("to_code").notNull(),
    startTime: time("start_time"),
    endTime: time("end_time"),
    reason: text("reason").notNull(),
    status: rosterRevisionStatus("status").notNull().default("pending"),
    decidedBy: uuid("decided_by").references(() => users.id, {
      onDelete: "restrict",
    }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decisionNote: text("decision_note").notNull().default(""),
  },
  (table) => [
    index("roster_revision_items_revision_id_idx").on(table.revisionId),
    /** The approval queue reads by status. */
    index("roster_revision_items_status_idx").on(table.status),
    /** The import's "which approved revisions would this file revert" pass (D9). */
    index("roster_revision_items_employee_date_idx").on(
      table.employeeId,
      table.date
    ),
  ]
);

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
  /**
   * Which half of the day this stage governs.
   *
   * The schedule used to be the morning's alone, so the shift was implicit in
   * the clock. Now that FTW and fingerprint are required on both shifts, two
   * rows can carry the same action twelve hours apart, and the reader that
   * asks "when is the finger-in deadline for the night shift" needs an answer
   * that does not depend on comparing times and guessing.
   *
   * Nullable, and null means "neither in particular" — the `other` markers an
   * operator adds govern no shift and should not have to claim one.
   */
  shift: shiftKind("shift"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

/* ------------------------------------------------------ readiness snapshots */

/**
 * Local snapshots of the two external readiness sources, written by the
 * `ftw-ingest` / `finger-ingest` timeline stages and the manual sync routes.
 *
 * Deliberately denormalized text, and deliberately no foreign key to
 * `employees`: these rows mirror what savera / the fingerprint machines said,
 * including people this system has no employee record for. Dropping or
 * re-keying them would make the snapshot lie about its source. Matching to a
 * local operator happens where it is needed, by normalized NIK.
 *
 * One row per person per day (`nik`, `date` unique), upserted idempotently —
 * a re-pull inside an ingest window or a manual sync amends the row, never
 * duplicates it. History accumulates here so historical questions are
 * answered locally instead of by re-querying the sources.
 */
export const ftwReadings = pgTable(
  "ftw_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Normalized (digits only, no leading zeros) — the join key to us. */
    nik: text("nik").notNull(),
    date: date("date").notNull(),
    name: text("name").notNull(),
    company: text("company"),
    department: text("department"),
    position: text("position"),
    mess: text("mess"),
    shift: text("shift"),
    /** `summaries.sleep` — the minutes savera's rules actually ran against. */
    sleepMinutes: integer("sleep_minutes").notNull().default(0),
    /** savera's verdicts as text: their rules are operator-configurable, so an
     *  enum here would break on their next edit, not ours. */
    sleepCategory: text("sleep_category"),
    ftwDecision: text("ftw_decision"),
    /** When the operator uploaded, source-local time. String mode: the value
     *  passes through verbatim — a timezone conversion here would shift the
     *  morning's facts by the difference between server and site clocks. */
    sentAt: timestamp("sent_at", { mode: "string" }),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("ftw_readings_nik_date_idx").on(table.nik, table.date),
    index("ftw_readings_date_idx").on(table.date),
  ]
);

/**
 * First IN and first OUT tap per person per day, raw as the machines recorded
 * them — including a night-shift worker whose first tap of the day is an OUT,
 * and the occasional wrong button. Which taps *mean* presence for a shift is
 * roster-aware interpretation and belongs to the consumer (the Actual tab),
 * not to the snapshot.
 */
export const fingerReadings = pgTable(
  "finger_readings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Normalized (digits only, no leading zeros) — the join key to us. */
    nik: text("nik").notNull(),
    date: date("date").notNull(),
    /** Source-local tap times, string mode — see `ftwReadings.sentAt`. */
    firstInAt: timestamp("first_in_at", { mode: "string" }),
    firstInIp: text("first_in_ip"),
    firstOutAt: timestamp("first_out_at", { mode: "string" }),
    firstOutIp: text("first_out_ip"),
    syncedAt: timestamp("synced_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    uniqueIndex("finger_readings_nik_date_idx").on(table.nik, table.date),
    index("finger_readings_date_idx").on(table.date),
  ]
);

export type RoleRow = typeof roles.$inferSelect;
export type RolePermissionRow = typeof rolePermissions.$inferSelect;
export type UserRow = typeof users.$inferSelect;
export type DeviceRow = typeof devices.$inferSelect;
export type FingerprintMachineRow = typeof fingerprintMachines.$inferSelect;

export type UnitTypeRow = typeof unitTypes.$inferSelect;
export type UnitModelRow = typeof unitModels.$inferSelect;
export type UnitBrandRow = typeof unitBrands.$inferSelect;
export type MessRow = typeof mess.$inferSelect;
export type UnitClassRow = typeof unitClasses.$inferSelect;
export type SimperTypeRow = typeof simperTypes.$inferSelect;
export type SimperCodeRow = typeof simperCodes.$inferSelect;
export type DepartmentRow = typeof departments.$inferSelect;
export type WorkAreaRow = typeof workAreas.$inferSelect;
export type CompanyRow = typeof companies.$inferSelect;
export type PositionRow = typeof positions.$inferSelect;
export type UnitRow = typeof units.$inferSelect;
export type EmployeeRow = typeof employees.$inferSelect;
export type EmployeeSkillRow = typeof employeeSkills.$inferSelect;
export type BusScheduleRow = typeof busSchedules.$inferSelect;
export type RunTextRow = typeof runTexts.$inferSelect;
export type DeviceRunTextRow = typeof deviceRunTexts.$inferSelect;
export type SoundRow = typeof sounds.$inferSelect;
export type TimelineStageRow = typeof timelineStages.$inferSelect;
export type FtwReadingRow = typeof ftwReadings.$inferSelect;
export type FingerReadingRow = typeof fingerReadings.$inferSelect;
export type RosterDocumentRow = typeof rosterDocuments.$inferSelect;
export type RosterDayRow = typeof rosterDays.$inferSelect;
export type RosterRevisionRow = typeof rosterRevisions.$inferSelect;
export type RosterRevisionItemRow = typeof rosterRevisionItems.$inferSelect;
