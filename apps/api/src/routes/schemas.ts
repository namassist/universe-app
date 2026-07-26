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
  DEVICE_KINDS,
  MENU_SLUGS,
  SCOPES,
  type MenuSlug,
} from "@universe/contracts";

export const AccessModeSchema = t.UnionEnum(ACCESS_MODES);
export const ScopeSchema = t.UnionEnum(SCOPES);
export const MenuSlugSchema = t.UnionEnum(MENU_SLUGS);
export const DeviceKindSchema = t.UnionEnum(DEVICE_KINDS);

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
/* eslint-enable @typescript-eslint/no-unused-vars */

export const OptionalScopeSchema = t.Optional(ScopeUnion);
export const OptionalDeviceKindSchema = t.Optional(DeviceKindUnion);

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
