/**
 * TypeBox schemas shared across routes.
 *
 * These live in `apps/api`, never in `@universe/contracts`: they are runtime
 * values, and shipping them to the browser would drag Elysia into the bundle.
 * Web and mobile get their types from Eden and the OpenAPI spec instead.
 *
 * `t.UnionEnum` keeps a literal union intact where `t.Union(XS.map(t.Literal))`
 * would widen the tuple and infer every downstream value as `never`. It also
 * injects the *first* enum value when an optional field is absent, so it is
 * never used for anything a caller could use to pick its own privileges.
 */

import { t } from "elysia";
import {
  ACCESS_MODES,
  ACCOUNT_IMPORT_FIELDS,
  BLOOD_TYPES,
  DEVICE_KINDS,
  DISPLAY_LAYOUTS,
  EMPLOYEE_STATUSES,
  MASTER_KINDS,
  MCU_RESULTS,
  MENU_SLUGS,
  ROSTER_CODE_KINDS,
  ROSTER_CODES,
  ROSTER_DOCUMENT_STATUSES,
  ROSTER_REVISION_STATUSES,
  SHIFT_KINDS,
  RUNTEXT_COLORS,
  SCOPES,
  TIMELINE_ACTIONS,
  UNIT_STATUSES,
  type MenuSlug,
} from "@universe/contracts";

export const AccessModeSchema = t.UnionEnum(ACCESS_MODES);
export const ScopeSchema = t.UnionEnum(SCOPES);
export const MenuSlugSchema = t.UnionEnum(MENU_SLUGS);
export const DeviceKindSchema = t.UnionEnum(DEVICE_KINDS);
export const DisplayLayoutSchema = t.UnionEnum(DISPLAY_LAYOUTS);
export const MasterKindSchema = t.UnionEnum(MASTER_KINDS);
export const RunTextColorSchema = t.UnionEnum(RUNTEXT_COLORS);
export const TimelineActionSchema = t.UnionEnum(TIMELINE_ACTIONS);
export const ShiftKindSchema = t.UnionEnum(SHIFT_KINDS);
export const EmployeeStatusSchema = t.UnionEnum(EMPLOYEE_STATUSES);
export const McuResultSchema = t.UnionEnum(MCU_RESULTS);
export const BloodTypeSchema = t.UnionEnum(BLOOD_TYPES);
export const RosterCodeSchema = t.UnionEnum(ROSTER_CODES);
export const RosterCodeKindSchema = t.UnionEnum(ROSTER_CODE_KINDS);
export const RosterDocumentStatusSchema = t.UnionEnum(ROSTER_DOCUMENT_STATUSES);
export const RosterRevisionStatusSchema = t.UnionEnum(ROSTER_REVISION_STATUSES);
export const UnitStatusSchema = t.UnionEnum(UNIT_STATUSES);

/* --------------------------------------------------------- optional enums */

/**
 * `t.Optional(t.UnionEnum([...]))` injects the *first* enum value when the
 * field is absent, which silently turns "the caller said nothing" into "the
 * caller said the first option". On a PATCH that is a data-loss bug, and on a
 * privilege field it is worse: an edit to a role's permission matrix alone
 * would reset its scope to `all`.
 *
 * Spelled-out literal unions do not inject, and — unlike `XS.map(t.Literal)`,
 * which widens the tuple and infers every downstream value as `never` — they
 * keep the literal type intact. The assertions below fail the build if either
 * list drifts from the contracts constant it mirrors.
 */
const ScopeUnion = t.Union([
  t.Literal("all"),
  t.Literal("dept"),
  t.Literal("self"),
]);

const DeviceKindUnion = t.Union([
  t.Literal("att"),
  t.Literal("fleet"),
  t.Literal("fitwork"),
  t.Literal("fingerprint"),
]);

const RunTextColorUnion = t.Union([
  t.Literal("Cyan"),
  t.Literal("Oranye"),
  t.Literal("Putih"),
  t.Literal("Merah"),
]);

const TimelineActionUnion = t.Union([
  t.Literal("ftw-deadline"),
  t.Literal("ftw-ingest"),
  t.Literal("finger-in"),
  t.Literal("finger-ingest"),
  t.Literal("spare-validate"),
  t.Literal("bus-depart"),
  t.Literal("other"),
]);

const ShiftKindUnion = t.Union([t.Literal("day"), t.Literal("night")]);

const EmployeeStatusUnion = t.Union([
  t.Literal("aktif"),
  t.Literal("standby"),
  t.Literal("nonaktif"),
]);

const McuResultUnion = t.Union([
  t.Literal("Fit"),
  t.Literal("Fit dengan catatan"),
  t.Literal("Unfit sementara"),
]);

const BloodTypeUnion = t.Union([
  t.Literal("A"),
  t.Literal("B"),
  t.Literal("AB"),
  t.Literal("O"),
]);

const RosterDocumentStatusUnion = t.Union([
  t.Literal("aktif"),
  t.Literal("arsip"),
]);

const RosterRevisionStatusUnion = t.Union([
  t.Literal("pending"),
  t.Literal("approved"),
  t.Literal("rejected"),
]);

/**
 * Twenty-nine literals rather than `t.UnionEnum(ROSTER_CODES)`, for the reason
 * at the top of this block: as an *optional* query filter, `UnionEnum` would
 * inject `"D"` when the caller sent no code at all — silently turning "every
 * code" into "day shift only", which is a filtered answer that looks like a
 * complete one. The assertion below fails the build if the list drifts.
 */
const RosterCodeUnion = t.Union([
  t.Literal("D"),
  t.Literal("N"),
  t.Literal("R"),
  t.Literal("STB"),
  t.Literal("OFF"),
  t.Literal("CR"),
  t.Literal("AL"),
  t.Literal("LWP"),
  t.Literal("LWOP"),
  t.Literal("PH"),
  t.Literal("PHD"),
  t.Literal("S"),
  t.Literal("SICK"),
  t.Literal("A"),
  t.Literal("MCU"),
  t.Literal("MCR"),
  t.Literal("MCUF"),
  t.Literal("ISM"),
  t.Literal("OBC"),
  t.Literal("KRT"),
  t.Literal("TGS"),
  t.Literal("DNS"),
  t.Literal("TRV"),
  t.Literal("TR"),
  t.Literal("TRS"),
  t.Literal("IN"),
  t.Literal("TERM"),
  t.Literal("EOC"),
  t.Literal("RSG"),
]);

type IsExact<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;

/* Referenced by nothing on purpose: their only job is to stop compiling if a
   literal list above drifts from the contracts constant it mirrors. */
/* eslint-disable @typescript-eslint/no-unused-vars */
type _ScopeInSync = Assert<
  IsExact<(typeof ScopeUnion)["static"], (typeof SCOPES)[number]>
>;
type _DeviceKindInSync = Assert<
  IsExact<(typeof DeviceKindUnion)["static"], (typeof DEVICE_KINDS)[number]>
>;
type _RunTextColorInSync = Assert<
  IsExact<(typeof RunTextColorUnion)["static"], (typeof RUNTEXT_COLORS)[number]>
>;
type _TimelineActionInSync = Assert<
  IsExact<
    (typeof TimelineActionUnion)["static"],
    (typeof TIMELINE_ACTIONS)[number]
  >
>;
type _ShiftKindInSync = Assert<
  IsExact<(typeof ShiftKindUnion)["static"], (typeof SHIFT_KINDS)[number]>
>;
type _EmployeeStatusInSync = Assert<
  IsExact<
    (typeof EmployeeStatusUnion)["static"],
    (typeof EMPLOYEE_STATUSES)[number]
  >
>;
type _McuResultInSync = Assert<
  IsExact<(typeof McuResultUnion)["static"], (typeof MCU_RESULTS)[number]>
>;
type _BloodTypeInSync = Assert<
  IsExact<(typeof BloodTypeUnion)["static"], (typeof BLOOD_TYPES)[number]>
>;
type _RosterCodeInSync = Assert<
  IsExact<(typeof RosterCodeUnion)["static"], (typeof ROSTER_CODES)[number]>
>;
type _RosterDocumentStatusInSync = Assert<
  IsExact<
    (typeof RosterDocumentStatusUnion)["static"],
    (typeof ROSTER_DOCUMENT_STATUSES)[number]
  >
>;
type _RosterRevisionStatusInSync = Assert<
  IsExact<
    (typeof RosterRevisionStatusUnion)["static"],
    (typeof ROSTER_REVISION_STATUSES)[number]
  >
>;
/* eslint-enable @typescript-eslint/no-unused-vars */

export const OptionalScopeSchema = t.Optional(ScopeUnion);
export const OptionalDeviceKindSchema = t.Optional(DeviceKindUnion);
export const OptionalRunTextColorSchema = t.Optional(RunTextColorUnion);
export const OptionalTimelineActionSchema = t.Optional(TimelineActionUnion);
/** Nullable as well as optional: absent leaves the shift, `null` clears it. */
export const OptionalShiftKindSchema = t.Optional(t.Nullable(ShiftKindUnion));
export const OptionalEmployeeStatusSchema = t.Optional(EmployeeStatusUnion);
/** Nullable as well as optional: absent leaves it, `null` clears it. */
export const OptionalMcuResultSchema = t.Optional(t.Nullable(McuResultUnion));
export const OptionalBloodTypeSchema = t.Optional(t.Nullable(BloodTypeUnion));
export const OptionalRosterCodeSchema = t.Optional(RosterCodeUnion);
export const OptionalRosterDocumentStatusSchema = t.Optional(
  RosterDocumentStatusUnion
);
export const OptionalRosterRevisionStatusSchema = t.Optional(
  RosterRevisionStatusUnion
);

export const ErrorSchema = t.Object({
  code: t.String(),
  message: t.String(),
});

/**
 * slug → mode. Absent slug means no access; `none` is never transmitted.
 *
 * Built as a partial object over the known slugs rather than `t.Record`, which
 * widens the key type and leaves every downstream `permissions` inferring as
 * `never`. Spelling out the keys also puts the real slug list in the OpenAPI
 * spec, which is what a mobile client generates from.
 */
export const PermissionsSchema = t.Partial(
  t.Object(
    Object.fromEntries(
      MENU_SLUGS.map((slug) => [slug, AccessModeSchema])
    ) as Record<MenuSlug, typeof AccessModeSchema>
  )
);

/**
 * The same map as a *request* body, keyed loosely on purpose.
 *
 * The response schema above names every slug, which is what the OpenAPI spec
 * needs — but as a body schema it would let Elysia strip an unknown slug before
 * the handler ever sees it, and a request to grant a menu that does not exist
 * would be answered with 201 and an empty grant. Accepting any key here lets
 * the handler reject it with 422 and name the offending slug.
 */
export const PermissionsInputSchema = t.Record(t.String(), AccessModeSchema);

/**
 * The account shape every endpoint returns. There is deliberately no
 * `passwordHash` member — the schema, not a convention, is what guarantees a
 * hash cannot leave the API.
 */
export const UserSchema = t.Object({
  id: t.String(),
  email: t.Nullable(t.String()),
  nik: t.Nullable(t.String()),
  name: t.String(),
  roleId: t.String(),
  roleName: t.String(),
  scope: ScopeSchema,
  active: t.Boolean(),
  mustChangePassword: t.Boolean(),
  createdAt: t.String(),
});

export const UserPrincipalSchema = t.Object({
  kind: t.Literal("user"),
  id: t.String(),
  name: t.String(),
  email: t.Nullable(t.String()),
  nik: t.Nullable(t.String()),
  roleId: t.String(),
  roleName: t.String(),
  scope: ScopeSchema,
  mustChangePassword: t.Boolean(),
});

export const DevicePrincipalSchema = t.Object({
  kind: t.Literal("device"),
  id: t.String(),
  name: t.String(),
  deviceKind: DeviceKindSchema,
});

export const PrincipalSchema = t.Union([
  UserPrincipalSchema,
  DevicePrincipalSchema,
]);

export const RoleSchema = t.Object({
  id: t.String(),
  slug: t.String(),
  name: t.String(),
  description: t.String(),
  scope: ScopeSchema,
  locked: t.Boolean(),
  userCount: t.Integer(),
  permissions: PermissionsSchema,
  createdAt: t.String(),
});

/* ---------------------------------------------------------- account import */

const ImportChangeSchema = t.Object({
  field: t.UnionEnum(ACCOUNT_IMPORT_FIELDS),
  from: t.Nullable(t.String()),
  to: t.Nullable(t.String()),
});

const ImportPreviewRowSchema = t.Object({
  row: t.Integer(),
  kind: t.Union([t.Literal("new"), t.Literal("updated")]),
  nik: t.String(),
  nama: t.String(),
  email: t.Nullable(t.String()),
  role: t.String(),
  changes: t.Array(ImportChangeSchema),
});

/** Mirrors the roster upload's error row so the results table is identical. */
const ImportErrorSchema = t.Object({
  row: t.String(),
  nik: t.String(),
  emp: t.String(),
  issue: t.String(),
  badgeVariant: t.Union([t.Literal("danger"), t.Literal("warning")]),
  badge: t.String(),
});

export const ImportPreviewSchema = t.Object({
  fileName: t.String(),
  newCount: t.Integer(),
  updatedCount: t.Integer(),
  errorCount: t.Integer(),
  rows: t.Array(ImportPreviewRowSchema),
  errors: t.Array(ImportErrorSchema),
});

export const ImportResultSchema = t.Object({
  created: t.Integer(),
  updated: t.Integer(),
});

/* ----------------------------------------------------------- fleet import */

/**
 * The fleet composition and PLAN pairing imports. Their `errors` are the one
 * shared `ImportErrorSchema` — the results table in the web app is one
 * component, so the wire shape has to be one shape.
 */
const FleetImportChangeSchema = t.Object({
  field: t.Union([
    t.Literal("area"),
    t.Literal("units"),
    t.Literal("transport"),
  ]),
  from: t.Nullable(t.String()),
  to: t.Nullable(t.String()),
});

const FleetImportPreviewRowSchema = t.Object({
  row: t.Integer(),
  kind: t.Union([
    t.Literal("new"),
    t.Literal("updated"),
    t.Literal("unchanged"),
  ]),
  leader: t.String(),
  area: t.String(),
  units: t.Array(t.String()),
  transports: t.Array(t.String()),
  changes: t.Array(FleetImportChangeSchema),
});

/** One crewed unit outside every formation, breakdowns included. */
const FleetImportSupportRowSchema = t.Object({
  row: t.Integer(),
  unit: t.String(),
  area: t.Nullable(t.String()),
  transport: t.Nullable(t.String()),
  breakdown: t.Boolean(),
});

export const FleetImportPreviewSchema = t.Object({
  fileName: t.String(),
  newCount: t.Integer(),
  updatedCount: t.Integer(),
  unchangedCount: t.Integer(),
  supportCount: t.Integer(),
  breakdownCount: t.Integer(),
  errorCount: t.Integer(),
  rows: t.Array(FleetImportPreviewRowSchema),
  support: t.Array(FleetImportSupportRowSchema),
  /** Leader codes of formations this file would disband. */
  disband: t.Array(t.String()),
  /** Codes of units this file drops out of today's operation. */
  released: t.Array(t.String()),
  errors: t.Array(ImportErrorSchema),
});

/** The fleet import reports more than two numbers; the shared one cannot. */
export const FleetImportResultSchema = t.Object({
  created: t.Integer(),
  updated: t.Integer(),
  disbanded: t.Integer(),
  support: t.Integer(),
  released: t.Integer(),
});

const PlanImportPreviewRowSchema = t.Object({
  row: t.Integer(),
  kind: t.Union([t.Literal("new"), t.Literal("moved"), t.Literal("unchanged")]),
  unit: t.String(),
  nik: t.String(),
  name: t.String(),
  fromUnit: t.Nullable(t.String()),
});

export const PlanImportPreviewSchema = t.Object({
  fileName: t.String(),
  newCount: t.Integer(),
  movedCount: t.Integer(),
  unchangedCount: t.Integer(),
  errorCount: t.Integer(),
  rows: t.Array(PlanImportPreviewRowSchema),
  errors: t.Array(ImportErrorSchema),
});

export const PlanImportResultSchema = t.Object({
  created: t.Integer(),
  moved: t.Integer(),
});

/* ----------------------------------------------------- master data import */

/**
 * The same two-step preview/commit shape, generalised over the catalogues and
 * the unit registry. `errors` is literally `ImportErrorSchema` — the results
 * table in the web app is one component, so the wire shape has to be one shape.
 */
const MasterImportChangeSchema = t.Object({
  field: t.String(),
  from: t.Nullable(t.String()),
  to: t.Nullable(t.String()),
});

const MasterImportPreviewRowSchema = t.Object({
  row: t.Integer(),
  kind: t.Union([
    t.Literal("new"),
    t.Literal("updated"),
    t.Literal("unchanged"),
  ]),
  key: t.String(),
  label: t.String(),
  /** Every non-empty cell of the row, in column order, joined by " - ". */
  data: t.String(),
  changes: t.Array(MasterImportChangeSchema),
});

/**
 * A catalogue record the unit import would create to satisfy a reference.
 * Always empty for a catalogue import, which references nothing.
 */
const PendingMasterSchema = t.Object({
  kind: MasterKindSchema,
  name: t.String(),
  rows: t.Integer(),
  /** An existing entry this looks like a misspelling of. Never blocks. */
  similarTo: t.Optional(t.String()),
});

export const MasterImportPreviewSchema = t.Object({
  fileName: t.String(),
  newCount: t.Integer(),
  updatedCount: t.Integer(),
  unchangedCount: t.Integer(),
  /** Blocking only — warnings are counted by `warnings.length`. */
  errorCount: t.Integer(),
  rows: t.Array(MasterImportPreviewRowSchema),
  errors: t.Array(ImportErrorSchema),
  warnings: t.Array(ImportErrorSchema),
  newMasters: t.Array(PendingMasterSchema),
});

export const MasterImportResultSchema = t.Object({
  created: t.Integer(),
  updated: t.Integer(),
  mastersCreated: t.Integer(),
});

/* ------------------------------------------------------- master catalogues */

/**
 * Three shapes, declared separately rather than as one row type with optional
 * members (design D1/D3).
 *
 * One generic handler serves all nine catalogues, but the OpenAPI document is
 * what a future mobile client generates from — and a schema saying "there may
 * or may not be a `type` field" tells that author nothing about which
 * catalogues have one. Naming the fields per shape is the whole reason the
 * polymorphic `a`/`b`/`c` table was rejected.
 */
export const MasterNameSchema = t.Object({
  id: t.String(),
  name: t.String(),
  active: t.Boolean(),
  createdAt: t.String(),
});

/** Unit classes, SIMPER permit types, SIMPER qualification codes, departments. */
export const MasterDescribedSchema = t.Object({
  id: t.String(),
  name: t.String(),
  description: t.String(),
  active: t.Boolean(),
  createdAt: t.String(),
});

/** A company: described, plus the short code the site refers to it by. */
export const MasterCompanySchema = t.Object({
  id: t.String(),
  name: t.String(),
  code: t.String(),
  description: t.String(),
  active: t.Boolean(),
  createdAt: t.String(),
});

/** A department, which belongs to exactly one company. */
export const MasterDepartmentSchema = t.Object({
  id: t.String(),
  name: t.String(),
  companyId: t.String(),
  description: t.String(),
  active: t.Boolean(),
  createdAt: t.String(),
});

/** A position, which belongs to exactly one department. */
export const MasterPositionSchema = t.Object({
  id: t.String(),
  name: t.String(),
  departmentId: t.String(),
  description: t.String(),
  /** Whether someone in this position is allocated a unit. */
  fleetAllocation: t.Boolean(),
  active: t.Boolean(),
  createdAt: t.String(),
});

/**
 * Order is load-bearing: a union is checked variant by variant, and a described
 * row also satisfies the name-only shape (extra members are allowed). Most
 * specific first, or a described row validates as a bare name and its
 * `description` is normalised away before it reaches the client.
 *
 * The three owned shapes lead for the same reason — a department row also
 * satisfies `MasterDescribedSchema`, and matching that first would strip the
 * `companyId` the screen groups by before the client ever saw it.
 */
export const MasterRecordSchema = t.Union([
  MasterCompanySchema,
  MasterDepartmentSchema,
  MasterPositionSchema,
  MasterDescribedSchema,
  MasterNameSchema,
]);

/**
 * The outcome of deleting a hand-picked selection.
 *
 * `blocked` carries the name and the referencing count rather than just an id,
 * because the caller's list may already have moved on and "3 could not be
 * deleted" is not something an operator can act on. `deleted + blocked.length`
 * always equals the number of distinct ids asked for.
 */
export const MasterBulkDeleteResultSchema = t.Object({
  deleted: t.Integer(),
  blocked: t.Array(
    t.Object({
      id: t.String(),
      name: t.String(),
      references: t.Integer(),
    })
  ),
});

/* ------------------------------------------------------------ unit registry */

/**
 * A unit, with each catalogue reference carried as both its key and its name.
 *
 * The key is the truth and the name is a join result, but shipping only keys
 * would mean a thirteen-column table costing seven requests to render — and
 * shipping only names would undo D2 at the API boundary, since the client
 * would then have nothing to send back but a string. Both, and the list renders
 * in one round trip while every write still speaks in keys.
 */
export const UnitSchema = t.Object({
  id: t.String(),
  code: t.String(),
  classId: t.String(),
  className: t.String(),
  typeId: t.String(),
  typeName: t.String(),
  modelId: t.String(),
  modelName: t.String(),
  brandId: t.String(),
  brandName: t.String(),
  /** Absent is a real state: a wheel excavator needs no qualification code. */
  simperCodeId: t.Nullable(t.String()),
  simperCodeName: t.Nullable(t.String()),
  /** Absent means no department owns it — a company-wide asset. */
  departmentId: t.Nullable(t.String()),
  departmentName: t.Nullable(t.String()),
  serial: t.String(),
  engineBrand: t.String(),
  description: t.String(),
  ftw: t.Boolean(),
  active: t.Boolean(),
  standby: t.Boolean(),
  breakdown: t.Boolean(),
  createdAt: t.String(),
});

/**
 * The outcome of deleting a hand-picked selection of units.
 *
 * Keyed by `code` rather than id, because that is what the unit API addresses a
 * unit by everywhere else and what the operator ticked in the list. `reason`
 * rather than a count: a unit has at most one bus schedule, so "1" would say
 * less than naming what is holding it.
 */
export const UnitBulkDeleteResultSchema = t.Object({
  deleted: t.Integer(),
  blocked: t.Array(t.Object({ code: t.String(), reason: t.String() })),
});

export const BusScheduleSchema = t.Object({
  id: t.String(),
  unitId: t.String(),
  unitCode: t.String(),
  /** "HH:MM" — the schedule is specified to the minute, and read as one. */
  departAt: t.String(),
  active: t.Boolean(),
  createdAt: t.String(),
});

/* --------------------------------------------------------------- unit status */

/**
 * A unit as the status screen reads it. `location` is the owning fleet's work
 * area — null for a unit no fleet holds — and `updatedAt` is the latest
 * status change, null for a unit whose status was never touched.
 */
export const UnitStatusRowSchema = t.Object({
  id: t.String(),
  code: t.String(),
  modelName: t.String(),
  brandName: t.String(),
  status: UnitStatusSchema,
  location: t.Nullable(t.String()),
  updatedAt: t.Nullable(t.String()),
});

export const UnitStatusHistorySchema = t.Object({
  id: t.String(),
  status: UnitStatusSchema,
  reason: t.String(),
  createdAt: t.String(),
});

/* -------------------------------------------------------------------- fleets */

/**
 * A fleet, with every unit reference carried as both key and code — the
 * `UnitSchema` bargain. The screen names a fleet by its digger, filters its
 * member picker by what other fleets already hold, and labels the location by
 * name, so the ids alone would put a join on the client.
 */
/** A unit in a formation, with the vehicle that brings its crew. */
export const FleetMemberSchema = t.Object({
  id: t.String(),
  code: t.String(),
  transportUnitId: t.Nullable(t.String()),
  transportCode: t.Nullable(t.String()),
});

export const FleetSchema = t.Object({
  id: t.String(),
  leaderUnitId: t.String(),
  leaderCode: t.String(),
  /** The leader's, which every member is held to on write. */
  workArea: t.String(),
  /** The leader's own ride — it is not a member row, so it is carried here. */
  leaderTransportUnitId: t.Nullable(t.String()),
  leaderTransportCode: t.Nullable(t.String()),
  units: t.Array(FleetMemberSchema),
  active: t.Boolean(),
  createdAt: t.String(),
});

/**
 * The no-fleet entry: units that take part in allocation without belonging to
 * a formation.
 *
 * Just a list, with no id and no record of its own — it is a fixed part of
 * Fleet Setting rather than a fleet, which is exactly what makes it something
 * nobody can delete.
 */
export const NoFleetSchema = t.Object({
  units: t.Array(
    t.Object({
      id: t.String(),
      code: t.String(),
      /** Whether this unit is crewed anyway — see `units.fleet_support`. */
      fleetSupport: t.Boolean(),
      workArea: t.Nullable(t.String()),
      transportCode: t.Nullable(t.String()),
    })
  ),
});

/**
 * What a bulk fleet delete reports back.
 *
 * A count and nothing else, unlike the master and unit results next to it:
 * nothing can refuse a fleet — both of its referrers cascade — so there is no
 * refused list to carry. `deleted` is the number of distinct ids asked for,
 * including any that were already gone.
 */
export const FleetBulkDeleteResultSchema = t.Object({
  deleted: t.Integer(),
});

/** How many units a support write touched. */
export const FleetSupportResultSchema = t.Object({
  changed: t.Integer(),
});

/* ------------------------------------------------------------------ employees */

/** A qualification code an employee holds — key and name, like every reference. */
export const EmployeeSkillSchema = t.Object({
  id: t.String(),
  name: t.String(),
});

/**
 * An employee, with each catalogue reference carried as both its key and its
 * name — the same bargain `UnitSchema` strikes, and for the same reason: a
 * list of two hundred people renders in one round trip while every write still
 * speaks in keys.
 *
 * The nullable members are all real states rather than unfinished records: an
 * employee may live off site (`mess`), operate nothing (`simperType`), have no
 * photo, or simply not have had a date recorded. Dates are ISO `YYYY-MM-DD`
 * strings, which is what Postgres `date` reads back as and what an `<input
 * type="date">` writes.
 */
export const EmployeeSchema = t.Object({
  id: t.String(),
  nik: t.String(),
  name: t.String(),
  companyId: t.String(),
  companyName: t.String(),
  positionId: t.String(),
  positionName: t.String(),
  departmentId: t.String(),
  departmentName: t.String(),
  /** Absent means the employee lives off site. */
  messId: t.Nullable(t.String()),
  messName: t.Nullable(t.String()),
  /** Absent means no permit at all — someone who operates no unit. */
  simperTypeId: t.Nullable(t.String()),
  simperTypeName: t.Nullable(t.String()),
  joinDate: t.Nullable(t.String()),
  license: t.String(),
  simperNo: t.String(),
  simperExp: t.Nullable(t.String()),
  mcu: t.Nullable(McuResultSchema),
  mcuExp: t.Nullable(t.String()),
  blood: t.Nullable(BloodTypeSchema),
  medical: t.String(),
  block: t.String(),
  room: t.String(),
  phone: t.String(),
  emergency: t.String(),
  /** The generated storage name, not the one the client uploaded. Null if none. */
  photoFileName: t.Nullable(t.String()),
  status: EmployeeStatusSchema,
  /** What this person may operate. Empty for anyone who operates nothing. */
  skills: t.Array(EmployeeSkillSchema),
  createdAt: t.String(),
});

/**
 * The shape a reference failure takes.
 *
 * Names the field, following `units.ts`: a form with five catalogue dropdowns
 * cannot act on "a reference did not resolve".
 */
export const ValidationIssuesSchema = t.Object({
  code: t.String(),
  message: t.String(),
  issues: t.Array(t.Object({ field: t.String(), message: t.String() })),
});

/* ---------------------------------------------------------- display content */

export const RunTextSchema = t.Object({
  id: t.String(),
  text: t.String(),
  color: RunTextColorSchema,
  active: t.Boolean(),
  createdAt: t.String(),
});

/**
 * A device's own text. No `active` flag on purpose (design D8): *having* rows
 * is what overrides the master list, so a deactivated last row would be
 * indistinguishable from a deleted one and the fallback rule would read two
 * ways at once.
 */
export const DeviceRunTextSchema = t.Object({
  text: t.String(),
  color: RunTextColorSchema,
});

/** What a kiosk actually renders — the fallback already resolved. */
export const DisplayContentSchema = t.Object({
  kind: DeviceKindSchema,
  device: t.Nullable(t.String()),
  servedAt: t.String(),
  runTexts: t.Array(DeviceRunTextSchema),
});

export const SoundSchema = t.Object({
  id: t.String(),
  name: t.String(),
  /** The generated storage name, not the one the client uploaded. */
  fileName: t.String(),
  mimeType: t.String(),
  sizeBytes: t.Integer(),
  active: t.Boolean(),
  createdAt: t.String(),
});

/* ------------------------------------------------------ allocation schedule */

export const TimelineStageSchema = t.Object({
  id: t.String(),
  name: t.String(),
  /** "HH:MM" — a time of day, not an instant: a stage recurs every morning. */
  at: t.String(),
  action: TimelineActionSchema,
  /** Which half of the day the stage governs; null means neither. */
  shift: t.Nullable(ShiftKindSchema),
  active: t.Boolean(),
  createdAt: t.String(),
});

/* ------------------------------------------------------ actual allocation */

export const ActualDocumentSchema = t.Object({
  date: t.String(),
  shift: ShiftKindSchema,
  generatedAt: t.String(),
  total: t.Number(),
  viaPlan: t.Number(),
  viaSpare: t.Number(),
  viaManual: t.Number(),
  /** Units with nobody on them — the number the screen exists to show. */
  idle: t.Number(),
});

export const ActualSlotSchema = t.Object({
  unitId: t.String(),
  unitCode: t.String(),
  requiresFtw: t.Boolean(),
  simperCodeName: t.Nullable(t.String()),
  departmentName: t.Nullable(t.String()),
  modelName: t.String(),
  brandName: t.String(),
  /** Null for a unit in no formation — support gear, and the spare pool's. */
  fleet: t.Nullable(
    t.Object({
      id: t.String(),
      leaderCode: t.String(),
      area: t.Nullable(t.String()),
    })
  ),
  employeeId: t.Nullable(t.String()),
  employeeNik: t.Nullable(t.String()),
  employeeName: t.Nullable(t.String()),
  source: t.Nullable(t.UnionEnum(["plan", "spare", "manual"] as const)),
  tappedAt: t.Nullable(t.String()),
});

export const ActualBoardSchema = t.Object({
  date: t.String(),
  shift: ShiftKindSchema,
  generatedAt: t.String(),
  fleets: t.Array(t.Object({ id: t.String(), leaderCode: t.String() })),
  slots: t.Array(ActualSlotSchema),
});

/**
 * One line of the board's audit table: an operator the roster put on this
 * shift, and what became of them.
 *
 * The row is the *person*, not the slot — "unit plan → unit actual" is a
 * movement, and a movement needs someone to move. Units nobody filled are
 * already visible on the board above.
 */
export const ActualAuditRowSchema = t.Object({
  /** The formation their standing unit belongs to; null makes them a spare. */
  fleetDiggerCode: t.Nullable(t.String()),
  /** Their standing unit, or null — which the screen shows as SPARE. */
  planUnitCode: t.Nullable(t.String()),
  nik: t.String(),
  name: t.String(),
  /** The SIMPER codes they hold, by name. */
  skills: t.Array(t.String()),
  ftw: t.UnionEnum([
    "pass",
    "fail",
    "late",
    "missing",
    "unreadable",
    "not-required",
  ] as const),
  /** "HH:MM:SS" the FTW was uploaded; null when there is no reading. */
  sentAt: t.Nullable(t.String()),
  finger: t.UnionEnum(["pass", "late", "missing"] as const),
  /** "HH:MM:SS" of the IN tap the roster says belongs to this shift. */
  tappedAt: t.Nullable(t.String()),
  /** The unit this board actually put them on, or null. */
  actualUnitCode: t.Nullable(t.String()),
  /**
   * What the board did about this person, in one word.
   *
   * An *outcome*, not a reason — the columns beside it carry the evidence.
   * `kept` and `substitute` come from the engine's own stored `source` rather
   * than from comparing unit codes, because only the source can tell a spare
   * who happened to land on their own unit from a holder the plan kept.
   */
  decision: t.UnionEnum([
    /** Placed by the plan, on the unit they hold. */
    "kept",
    /** Placed from the spare pool, filling a seat. */
    "substitute",
    /** Placed by a supervisor after the board was generated. */
    "manual",
    /** Not placed, and not ready — FTW or the tap stood in the way. */
    "not-ready",
    /** Ready, and still placed nowhere: no seat they could take. */
    "no-seat",
  ] as const),
});

export const ActualAuditSchema = t.Object({
  date: t.String(),
  shift: ShiftKindSchema,
  rows: t.Array(ActualAuditRowSchema),
});

export const ActualCandidateSchema = t.Object({
  employeeId: t.String(),
  nik: t.String(),
  name: t.String(),
  tappedAt: t.Nullable(t.String()),
  /** "HH:MM:SS" the FTW was uploaded; null when there is no reading. */
  sentAt: t.Nullable(t.String()),
  ftw: t.UnionEnum([
    "pass",
    "fail",
    /** Uploaded after this shift's `ftw-deadline` — refused, but overridable. */
    "late",
    "missing",
    "unreadable",
    "not-required",
  ] as const),
  finger: t.UnionEnum(["pass", "late", "missing"] as const),
  /**
   * The *readiness* verdict only — FTW and the tap. It is not "may take this
   * unit": someone can be ready and still refused by the eligibility rule
   * below, and a consumer reading this alone would place them.
   */
  ready: t.Boolean(),
  /** The eligibility rule's own words, or null when nothing stands in the way. */
  refusal: t.Nullable(t.String()),
  onAnotherUnit: t.Boolean(),
});

/* ------------------------------------------------- the fleet wall (kiosk) */

/** One unit on the wall, cut down to what is legible from across a yard. */
export const FleetDisplayUnitSchema = t.Object({
  unitId: t.String(),
  unitCode: t.String(),
  modelName: t.String(),
  brandName: t.String(),
  /**
   * The vehicle bringing this unit's crew, or null when none is set.
   *
   * Per unit since 2026-09-04: two units of one formation may legitimately
   * ride different vehicles, so the group header can no longer speak for all
   * of them.
   */
  busCode: t.Nullable(t.String()),
  /** Null on an idle unit — the vacancy the wall exists to make obvious. */
  employeeNik: t.Nullable(t.String()),
  employeeName: t.Nullable(t.String()),
  /**
   * The stored file name of that person's photograph, or null when they have
   * none — the wall falls back to their initials.
   *
   * The name rather than a ready URL: the screen builds the URL itself, and
   * the name is what makes that URL change when a photo is replaced, so a wall
   * that has been running for a month does not keep showing a face out of
   * cache. The same bargain `photoUrl()` strikes on the employees screen.
   */
  employeePhotoFile: t.Nullable(t.String()),
  source: t.Nullable(t.UnionEnum(["plan", "spare", "manual"] as const)),
  tappedAt: t.Nullable(t.String()),
  /**
   * The FTW verdict for this pairing, or null when the timeline could not say
   * where the deadlines are and the wall declines to guess.
   *
   * Six values rather than pass/not-pass, because this screen is read by the
   * person it is about: "belum" sends them to fill the form in, "tidak lolos"
   * must not. `not-required` is its own value so a unit whose `ftw` flag is off
   * carries no FTW badge at all, rather than a reassuring green one that stands
   * for a check nobody made.
   */
  ftw: t.Nullable(
    t.UnionEnum([
      "pass",
      "fail",
      "late",
      "missing",
      "unreadable",
      "not-required",
    ] as const)
  ),
});

/**
 * One formation — the unit the wall rotates through, and the unit its counts
 * are reported in. A screen in one pit is read as being about that pit, so a
 * site-wide number on it would be read as the fleet's and be wrong.
 */
export const FleetDisplayFleetSchema = t.Object({
  id: t.String(),
  /**
   * A formation, or the one group holding the units that belong to none.
   * `support` sorts last and carries no leader and no single area.
   */
  kind: t.UnionEnum(["fleet", "support"] as const),
  leaderCode: t.Nullable(t.String()),
  area: t.Nullable(t.String()),
  /** Set only when every unit in the group rides the same vehicle. */
  busCode: t.Nullable(t.String()),
  total: t.Integer(),
  crewed: t.Integer(),
  idle: t.Integer(),
  /** Crewed by someone other than the planned holder: spare or manual. */
  substituted: t.Integer(),
  units: t.Array(FleetDisplayUnitSchema),
});

/**
 * What the fleet TV renders: the Actual board of whichever shift is running,
 * grouped into formations.
 *
 * Three states share this one shape rather than three status codes, because a
 * wall must render every one of them and an HTTP error renders as nothing:
 * `date` null means the timeline cannot say which shift is on, `generatedAt`
 * null means that shift's board has not been built yet, and otherwise it is a
 * board.
 */
export const FleetDisplaySchema = t.Object({
  servedAt: t.String(),
  date: t.Nullable(t.String()),
  shift: t.Nullable(ShiftKindSchema),
  generatedAt: t.Nullable(t.String()),
  /**
   * The line-up is the standing plan, not a generated board: shown while a
   * shift's changeover has begun but `spare-validate` has not run. A screen
   * renders it visibly unfinished — nobody has checked FTW or the tap yet.
   */
  provisional: t.Boolean(),
  /** Seconds one formation stays on screen — the screen's own setting. */
  rotateSeconds: t.Integer(),
  /**
   * Whether the wall shows one formation at a time or four at once. Either
   * way the fleets below arrive in the order the screen shows them, and
   * `rotateSeconds` is the dwell it turns pages at.
   */
  layout: DisplayLayoutSchema,
  /**
   * The registered screen's own name, or null when nobody named a device — a
   * person previewing the site-wide board. A monitor heads itself with it.
   */
  deviceName: t.Nullable(t.String()),
  /**
   * The formations, then the support group.
   *
   * Units in no formation used to be dropped here entirely, on the grounds
   * that the wall answers "how is this formation crewed". Since 2026-09-04 a
   * dozer or a water truck is crewed too, so they arrive as one group at the
   * end rather than disappearing — but as their own group, never mixed into a
   * pit somebody is standing in front of.
   */
  fleets: t.Array(FleetDisplayFleetSchema),
});

export const DeviceSchema = t.Object({
  id: t.String(),
  name: t.String(),
  kind: DeviceKindSchema,
  active: t.Boolean(),
  /** Seconds one subject stays on screen before the display rotates. */
  rotateSeconds: t.Integer(),
  /** How the wall spends itself: one formation at a time, or up to four. */
  layout: DisplayLayoutSchema,
  /**
   * Fleet walls: which formations to show, in the order the screen shows them.
   * Empty means every fleet.
   */
  fleetIds: t.Array(t.String()),
  online: t.Boolean(),
  lastSeenAt: t.Nullable(t.String()),
  /** Human label derived from lastSeenAt — "baru saja", "6m lalu". */
  lastSeenLabel: t.String(),
  createdAt: t.String(),
});

export const FingerprintMachineSchema = t.Object({
  id: t.String(),
  name: t.String(),
  /** IPv4 host address — the prober's target, and the machine's identity. */
  ip: t.String(),
  active: t.Boolean(),
  /** Last probe verdict, after the miss-count debounce. */
  online: t.Boolean(),
  /** Last probe that reached the machine; null until one ever has. */
  lastSeenAt: t.Nullable(t.String()),
  /** Last probe attempt — how fresh `online` is. */
  checkedAt: t.Nullable(t.String()),
  /** When the current status began, so a screen can say how long. */
  statusSince: t.Nullable(t.String()),
  createdAt: t.String(),
});

/** What the monitoring TV renders: the machines, plus its headline counts. */
export const FingerprintDisplaySchema = t.Object({
  servedAt: t.String(),
  total: t.Integer(),
  online: t.Integer(),
  offline: t.Integer(),
  machines: t.Array(FingerprintMachineSchema),
});

/* ---------------------------------------------------------------- roster */

/**
 * One monthly upload, with its department and uploader resolved — the same
 * key-and-name bargain `UnitSchema` and `EmployeeSchema` strike.
 *
 * `employeeCount` and `dayCount` are aggregates rather than stored columns: the
 * list shows both, and a stored counter is a number that can be wrong. `month`
 * is the ISO date of the first of the month, which is how it is stored and
 * compared.
 */
export const RosterDocumentSchema = t.Object({
  id: t.String(),
  departmentId: t.String(),
  departmentName: t.String(),
  /** ISO `YYYY-MM-01` — the first of the month the document covers. */
  month: t.String(),
  fileName: t.String(),
  uploadedById: t.String(),
  uploadedByName: t.String(),
  status: RosterDocumentStatusSchema,
  /** How many distinct people the document rosters. */
  employeeCount: t.Integer(),
  /** How many daily rows it holds in total. */
  dayCount: t.Integer(),
  createdAt: t.String(),
});

/**
 * One person's row in a document's grid.
 *
 * `codes` is positional — aligned to the `days` of the page envelope — rather
 * than a list of `{date, code}` pairs, because the grid is a fixed set of
 * columns and repeating the date on all 62,000 cells of a month would roughly
 * double the payload the pagination in D8 exists to bound. `null` is a day the
 * document carries no row for, which validation prevents on import but an
 * older document could still hold.
 */
export const RosterGridRowSchema = t.Object({
  employeeId: t.String(),
  nik: t.String(),
  name: t.String(),
  codes: t.Array(t.Nullable(RosterCodeSchema)),
});

/**
 * A page of the grid (design D8).
 *
 * Paginated by *employee*, never by cell: a row split across two pages is not a
 * row. `total` counts the people in the document, so the client can size the
 * pager without holding the month.
 */
export const RosterGridSchema = t.Object({
  /** The document's dates in order — the grid's columns. */
  days: t.Array(t.String()),
  rows: t.Array(RosterGridRowSchema),
  total: t.Integer(),
  page: t.Integer(),
  pageSize: t.Integer(),
});

/**
 * The roster in force for one date — the shape the allocation engine reads.
 *
 * `kind` is resolved from the code on the way out and never stored (D2), so a
 * row cannot disagree with the classification.
 */
export const RosterInForceSchema = t.Object({
  employeeId: t.String(),
  nik: t.String(),
  name: t.String(),
  departmentId: t.String(),
  code: RosterCodeSchema,
  kind: RosterCodeKindSchema,
});

/* ------------------------------------------------------------- roster import */

/**
 * The roster preview: the master import's shape, plus the handle its size
 * forces (design D8).
 *
 * `errors` and `warnings` come back whole — they are small, and they are the
 * part an operator actually reads. `rows` is one page of the accepted grid;
 * `token` fetches the rest, and `rowTotal` is how many there are so the pager
 * can be drawn without holding the month.
 */
export const RosterImportPreviewSchema = t.Object({
  fileName: t.String(),
  newCount: t.Integer(),
  updatedCount: t.Integer(),
  unchangedCount: t.Integer(),
  /** Blocking only — remarks are counted by `warnings.length`. */
  errorCount: t.Integer(),
  rows: t.Array(MasterImportPreviewRowSchema),
  errors: t.Array(ImportErrorSchema),
  warnings: t.Array(ImportErrorSchema),
  /** Always empty: the roster's one reference is stated, never read from file. */
  newMasters: t.Array(PendingMasterSchema),
  /**
   * Handle for the pages after the first. Null when the file could not be
   * staged — the preview is still correct, it simply cannot be paged, and the
   * commit is unaffected because it re-parses the file the client sends.
   */
  token: t.Nullable(t.String()),
  rowTotal: t.Integer(),
  page: t.Integer(),
  pageSize: t.Integer(),
});

/** One more page of an existing preview's accepted rows. */
export const RosterImportRowsSchema = t.Object({
  rows: t.Array(MasterImportPreviewRowSchema),
  rowTotal: t.Integer(),
  page: t.Integer(),
  pageSize: t.Integer(),
});

/**
 * What a commit did.
 *
 * The master result's three members are kept so the shared results panel reads
 * it unchanged, and four roster-specific ones are added because they are the
 * questions this import raises and no other does: which document is now in
 * force, which one it displaced, and how many pending revisions went down with
 * it (design D12).
 */
export const RosterImportResultSchema = t.Object({
  created: t.Integer(),
  updated: t.Integer(),
  mastersCreated: t.Integer(),
  documentId: t.String(),
  archivedDocumentId: t.Nullable(t.String()),
  rejectedRevisions: t.Integer(),
  employeeCount: t.Integer(),
});

/* ------------------------------------------------------------ roster revision */

/**
 * One requested change, with its decision if it has one.
 *
 * `submittedBy` rides on the entry as well as the submission so a queue row
 * carries both accounts: an approver deciding its own submission is permitted
 * (design D18), and the only thing that makes it auditable is that both names
 * come back together.
 */
export const RosterRevisionItemSchema = t.Object({
  id: t.String(),
  revisionId: t.String(),
  /** The readable submission identifier — `REV-0001`. */
  revisionCode: t.String(),
  documentId: t.String(),
  employeeId: t.String(),
  nik: t.String(),
  employeeName: t.String(),
  departmentId: t.String(),
  departmentName: t.String(),
  date: t.String(),
  fromCode: RosterCodeSchema,
  toCode: RosterCodeSchema,
  /** "HH:MM", and only where the submitter asked for a partial day. */
  startTime: t.Nullable(t.String()),
  endTime: t.Nullable(t.String()),
  reason: t.String(),
  status: RosterRevisionStatusSchema,
  submittedById: t.String(),
  submittedByName: t.String(),
  submittedAt: t.String(),
  decidedById: t.Nullable(t.String()),
  decidedByName: t.Nullable(t.String()),
  decidedAt: t.Nullable(t.String()),
  /** The rejection's reason, or the approval's optional note. */
  decisionNote: t.String(),
  /** False once the document it belongs to has been archived (design D12). */
  decidable: t.Boolean(),
});

/** A submission and its entries. Status lives on the entries, never here. */
export const RosterRevisionSchema = t.Object({
  id: t.String(),
  code: t.String(),
  documentId: t.String(),
  documentMonth: t.String(),
  documentStatus: RosterDocumentStatusSchema,
  departmentId: t.String(),
  departmentName: t.String(),
  submittedById: t.String(),
  submittedByName: t.String(),
  submittedAt: t.String(),
  items: t.Array(RosterRevisionItemSchema),
});

/**
 * A decision refused because the day moved under the entry (design D10).
 *
 * Names both codes rather than saying "stale": the approver has to decide
 * whether the change still makes sense against what the day now says, and
 * cannot do that from the fact that it changed.
 */
export const RosterConflictSchema = t.Object({
  code: t.String(),
  message: t.String(),
  recordedCode: RosterCodeSchema,
  currentCode: RosterCodeSchema,
});

/* ------------------------------------------------------ readiness ingest */

/** One sync pass's honest accounting — skipped rows are counted, not hidden. */
export const IngestSyncResultSchema = t.Object({
  fetched: t.Integer(),
  upserted: t.Integer(),
  /** Of those, rows that were not here before — what a person pressed Sync for. */
  inserted: t.Integer(),
  skipped: t.Integer(),
  syncedAt: t.String(),
});

/** Null until the first sync ever lands — a fact the screens must render. */
export const IngestSyncStatusSchema = t.Object({
  lastSyncedAt: t.Nullable(t.String()),
});

/** One person's FTW verdict for one day, as savera reported it. */
export const FtwReadingSchema = t.Object({
  nik: t.String(),
  date: t.String(),
  name: t.String(),
  company: t.Nullable(t.String()),
  department: t.Nullable(t.String()),
  position: t.Nullable(t.String()),
  mess: t.Nullable(t.String()),
  shift: t.Nullable(t.String()),
  sleepMinutes: t.Integer(),
  sleepCategory: t.Nullable(t.String()),
  ftwDecision: t.Nullable(t.String()),
  /** "YYYY-MM-DD HH:MM:SS", source-local. */
  sentAt: t.Nullable(t.String()),
  /**
   * Uploaded after its shift's `ftw-deadline`, so the board refuses it.
   * Computed from the timeline on the way out, never stored: moving the stage
   * moves the flag, and a stored one would be wrong the moment it did.
   */
  late: t.Boolean(),
});

export const FtwListSchema = t.Object({
  rows: t.Array(FtwReadingSchema),
  lastSyncedAt: t.Nullable(t.String()),
});

/**
 * One shift the morning is accountable for: a tap, a rostered shift, or both.
 *
 * A row with `firstInAt` null is someone rostered `D`/`N` who never tapped. A
 * row whose `rosterCode` is neither `D` nor `N` while `firstInAt` is set is
 * someone who tapped on a day the roster does not schedule. Both are states the
 * previous tap-driven list could not express.
 */
export const AttendanceReadingSchema = t.Object({
  nik: t.String(),
  date: t.String(),
  /** Null when the NIK matches no local employee — shown, not hidden. */
  name: t.Nullable(t.String()),
  department: t.Nullable(t.String()),
  /** The job title, not the shift — what the person is here to do. */
  position: t.Nullable(t.String()),
  company: t.Nullable(t.String()),
  /**
   * The roster's word for the day. `null` means we hold no roster for this
   * person at all — a gap in our records, not a contradiction of theirs, and
   * the screen is careful not to report it as one.
   */
  rosterCode: t.Nullable(t.String()),
  /** Null on a rostered shift nobody tapped for — the row exists to say so. */
  firstInAt: t.Nullable(t.String()),
  firstInIp: t.Nullable(t.String()),
  /** The registered machine at that address, falling back to the address. */
  firstInMachine: t.Nullable(t.String()),
  /**
   * Tapped in at or after this person's own shift gate. `null` means the
   * roster does not say which shift they are on, so lateness is unknowable —
   * a different fact from "on time".
   */
  late: t.Nullable(t.Boolean()),
});

export const AttendanceListSchema = t.Object({
  rows: t.Array(AttendanceReadingSchema),
  lastSyncedAt: t.Nullable(t.String()),
});

/* ------------------------------------------------- the readiness walls */

/**
 * What the attendance and fit-to-work TVs render.
 *
 * Two states share one shape, as on the fleet wall and for the same reason: a
 * screen must render every answer, and an HTTP error renders as nothing. A
 * null `date` means the timeline cannot say which shift is on; otherwise it is
 * a shift, and an empty `rows` with a zero `total` means nobody is rostered
 * onto it.
 *
 * `rows` is the exception list and is capped; the counts beside it are over
 * the whole roster. They are meant to disagree — that is what tells a reader
 * the screen is showing the worst of a larger number, not all of it.
 */
const WallEnvelope = {
  servedAt: t.String(),
  date: t.Nullable(t.String()),
  shift: t.Nullable(ShiftKindSchema),
  /** Everyone the active roster puts on this shift. */
  total: t.Integer(),
};

export const AttendanceDisplaySchema = t.Object({
  ...WallEnvelope,
  /** Tapped in before this shift's `finger-in` gate. */
  present: t.Integer(),
  /** Tapped in, but at or after it. */
  late: t.Integer(),
  /** Rostered with no IN tap for this shift's half of the day. */
  absent: t.Integer(),
  rows: t.Array(
    t.Object({
      nik: t.String(),
      name: t.String(),
      position: t.Nullable(t.String()),
      department: t.Nullable(t.String()),
      verdict: t.UnionEnum(["pass", "late", "missing"] as const),
      /** "HH:MM:SS" of the IN tap that counted, or null. */
      tappedAt: t.Nullable(t.String()),
    })
  ),
});

export const FitWorkDisplaySchema = t.Object({
  ...WallEnvelope,
  /** Uploaded something, whatever it said. */
  filed: t.Integer(),
  passed: t.Integer(),
  /** Filed but not accepted: refused, late, or a verdict we cannot read. */
  refused: t.Integer(),
  missing: t.Integer(),
  rows: t.Array(
    t.Object({
      nik: t.String(),
      name: t.String(),
      position: t.Nullable(t.String()),
      department: t.Nullable(t.String()),
      verdict: t.UnionEnum([
        "pass",
        "fail",
        "late",
        "missing",
        "unreadable",
        "not-required",
      ] as const),
      /** savera's sleep minutes, null when nothing was filed. */
      sleepMinutes: t.Nullable(t.Integer()),
      sleepCategory: t.Nullable(t.String()),
      /** "HH:MM:SS" the upload landed. */
      sentAt: t.Nullable(t.String()),
    })
  ),
});

/* ----------------------------------------------------------- the dashboard */

/**
 * The dashboard's payload. Every section is nullable, and null means the
 * caller holds no grant for it — not that the number is zero.
 */
export const DashboardSchema = t.Object({
  /** Site-local today, so the screen never re-derives it from a UTC instant. */
  date: t.String(),
  attendance: t.Nullable(
    t.Object({ scheduled: t.Integer(), tapped: t.Integer() })
  ),
  ftw: t.Nullable(
    t.Object({
      scheduled: t.Integer(),
      fit: t.Integer(),
      followUp: t.Integer(),
      missing: t.Integer(),
    })
  ),
  units: t.Nullable(
    t.Object({
      active: t.Integer(),
      breakdown: t.Integer(),
      standby: t.Integer(),
    })
  ),
  revisions: t.Nullable(
    t.Object({ pendingItems: t.Integer(), pendingDocs: t.Integer() })
  ),
  devices: t.Nullable(t.Object({ total: t.Integer(), offline: t.Integer() })),
  /** When the two external sources last answered; null when never. */
  ingest: t.Nullable(
    t.Object({
      ftwSyncedAt: t.Nullable(t.String()),
      fingerSyncedAt: t.Nullable(t.String()),
    })
  ),
  fleetConfig: t.Nullable(t.Object({ unitsWithOperatorNoFleet: t.Integer() })),
  /** One line per shift that has a board today; absent means not generated. */
  allocation: t.Nullable(
    t.Array(
      t.Object({
        shift: ShiftKindSchema,
        generatedAt: t.String(),
        slots: t.Integer(),
        filled: t.Integer(),
      })
    )
  ),
  /** Null until the employee register carries SIMPER expiry dates at all. */
  simper: t.Nullable(t.Object({ expired: t.Integer(), soon: t.Integer() })),
  /** The signed-in person's own day; null when the account has no NIK. */
  me: t.Nullable(
    t.Object({
      name: t.String(),
      nik: t.String(),
      rosterCode: t.Nullable(RosterCodeSchema),
      ftwDecision: t.Nullable(t.String()),
      tappedAt: t.Nullable(t.String()),
      unitCode: t.Nullable(t.String()),
      unitSource: t.Nullable(t.UnionEnum(["plan", "spare", "manual"] as const)),
      pendingRevisions: t.Integer(),
    })
  ),
  /**
   * The rows worth acting on, capped per kind. Facts only — the screen writes
   * the sentence and picks the badge, in the reader's language.
   */
  attention: t.Array(
    t.Object({
      kind: t.UnionEnum(["breakdown", "unfit", "absent", "display"] as const),
      name: t.String(),
      sub: t.String(),
      dept: t.String(),
      detail: t.Nullable(t.String()),
    })
  ),
});
