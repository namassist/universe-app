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
  AREA_TYPES,
  BLOOD_TYPES,
  DEVICE_KINDS,
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
export const MasterKindSchema = t.UnionEnum(MASTER_KINDS);
export const AreaTypeSchema = t.UnionEnum(AREA_TYPES);
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

const AreaTypeUnion = t.Union([t.Literal("Mining"), t.Literal("Non Mining")]);

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
 * Twenty-eight literals rather than `t.UnionEnum(ROSTER_CODES)`, for the reason
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
type _AreaTypeInSync = Assert<
  IsExact<(typeof AreaTypeUnion)["static"], (typeof AREA_TYPES)[number]>
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
export const OptionalAreaTypeSchema = t.Optional(AreaTypeUnion);
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
  field: t.Union([t.Literal("area"), t.Literal("bus"), t.Literal("units")]),
  from: t.Nullable(t.String()),
  to: t.Nullable(t.String()),
});

const FleetImportPreviewRowSchema = t.Object({
  row: t.Integer(),
  kind: t.Union([t.Literal("new"), t.Literal("updated")]),
  digger: t.String(),
  area: t.String(),
  bus: t.Nullable(t.String()),
  units: t.Array(t.String()),
  changes: t.Array(FleetImportChangeSchema),
});

export const FleetImportPreviewSchema = t.Object({
  fileName: t.String(),
  newCount: t.Integer(),
  updatedCount: t.Integer(),
  errorCount: t.Integer(),
  rows: t.Array(FleetImportPreviewRowSchema),
  errors: t.Array(ImportErrorSchema),
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

export const MasterWorkAreaSchema = t.Object({
  id: t.String(),
  name: t.String(),
  type: AreaTypeSchema,
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
 * Order is load-bearing: a union is checked variant by variant, and every
 * work-area row also satisfies the name-only shape (extra members are allowed).
 * Most specific first, or a described row validates as a bare name and its
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
  MasterWorkAreaSchema,
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
export const FleetSchema = t.Object({
  id: t.String(),
  diggerUnitId: t.String(),
  diggerCode: t.String(),
  workAreaId: t.String(),
  workAreaName: t.String(),
  busUnitId: t.Nullable(t.String()),
  busCode: t.Nullable(t.String()),
  units: t.Array(t.Object({ id: t.String(), code: t.String() })),
  active: t.Boolean(),
  createdAt: t.String(),
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
  slots: t.Array(ActualSlotSchema),
});

export const ActualCandidateSchema = t.Object({
  employeeId: t.String(),
  nik: t.String(),
  name: t.String(),
  tappedAt: t.Nullable(t.String()),
  ftw: t.UnionEnum([
    "pass",
    "fail",
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

export const DeviceSchema = t.Object({
  id: t.String(),
  name: t.String(),
  kind: DeviceKindSchema,
  active: t.Boolean(),
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
});

export const FtwListSchema = t.Object({
  rows: t.Array(FtwReadingSchema),
  lastSyncedAt: t.Nullable(t.String()),
});

/** One person's tap summary for one day, enriched from local records. */
export const AttendanceReadingSchema = t.Object({
  nik: t.String(),
  date: t.String(),
  /** Null when the NIK matches no local employee — shown, not hidden. */
  name: t.Nullable(t.String()),
  department: t.Nullable(t.String()),
  /** The roster's word for the day, when this NIK is rostered. */
  rosterCode: t.Nullable(t.String()),
  firstInAt: t.Nullable(t.String()),
  firstInIp: t.Nullable(t.String()),
  firstOutAt: t.Nullable(t.String()),
  firstOutIp: t.Nullable(t.String()),
});

export const AttendanceListSchema = t.Object({
  rows: t.Array(AttendanceReadingSchema),
  lastSyncedAt: t.Nullable(t.String()),
});
