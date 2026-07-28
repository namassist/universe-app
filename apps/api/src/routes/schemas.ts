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
  RUNTEXT_COLORS,
  SCOPES,
  TIMELINE_ACTIONS,
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
export const EmployeeStatusSchema = t.UnionEnum(EMPLOYEE_STATUSES);
export const McuResultSchema = t.UnionEnum(MCU_RESULTS);
export const BloodTypeSchema = t.UnionEnum(BLOOD_TYPES);

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
  t.Literal("finger-in"),
  t.Literal("finger-ingest"),
  t.Literal("spare-validate"),
  t.Literal("bus-depart"),
  t.Literal("other"),
]);

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
/* eslint-enable @typescript-eslint/no-unused-vars */

export const OptionalScopeSchema = t.Optional(ScopeUnion);
export const OptionalDeviceKindSchema = t.Optional(DeviceKindUnion);
export const OptionalAreaTypeSchema = t.Optional(AreaTypeUnion);
export const OptionalRunTextColorSchema = t.Optional(RunTextColorUnion);
export const OptionalTimelineActionSchema = t.Optional(TimelineActionUnion);
export const OptionalEmployeeStatusSchema = t.Optional(EmployeeStatusUnion);
/** Nullable as well as optional: absent leaves it, `null` clears it. */
export const OptionalMcuResultSchema = t.Optional(t.Nullable(McuResultUnion));
export const OptionalBloodTypeSchema = t.Optional(t.Nullable(BloodTypeUnion));

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

/**
 * Order is load-bearing: a union is checked variant by variant, and every
 * work-area row also satisfies the name-only shape (extra members are allowed).
 * Most specific first, or a described row validates as a bare name and its
 * `description` is normalised away before it reaches the client.
 */
export const MasterRecordSchema = t.Union([
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
  active: t.Boolean(),
  createdAt: t.String(),
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
