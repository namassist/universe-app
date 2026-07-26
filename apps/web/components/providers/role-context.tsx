"use client";

import * as React from "react";

import type {
  AccessMode,
  EffectivePermissions,
  MenuSlug,
  Scope,
  SessionPrincipal,
} from "@universe/contracts";

type RoleCtx = {
  principal: SessionPrincipal;
  /** Role name for display. Devices carry no role, hence the fallback. */
  roleLabel: string;
  scope: Scope | null;
  /** Access mode for a menu, or undefined when hidden for this caller. */
  access: (slug: MenuSlug) => AccessMode | undefined;
};

const Ctx = React.createContext<RoleCtx | null>(null);

/**
 * Supplies the caller's identity and effective grants to the shell and pages.
 *
 * The permissions arrive from the session endpoint rather than from a static
 * matrix or a URL segment: a role editable at runtime cannot be a build-time
 * constant, and a URL segment is an unverified claim. The `access(slug)` shape
 * is unchanged, so consumers did not have to move.
 */
export function RoleProvider({
  principal,
  permissions,
  children,
}: {
  principal: SessionPrincipal;
  permissions: EffectivePermissions;
  children: React.ReactNode;
}) {
  const value = React.useMemo<RoleCtx>(
    () => ({
      principal,
      roleLabel:
        principal.kind === "user" ? principal.roleName : principal.name,
      scope: principal.kind === "user" ? principal.scope : null,
      access: (slug) => permissions[slug],
    }),
    [principal, permissions]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRole(): RoleCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useRole must be used within a RoleProvider");
  return v;
}
