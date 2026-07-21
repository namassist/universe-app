"use client";

import * as React from "react";

import {
  accessOf,
  ROLE_LABELS,
  type AccessMode,
  type MenuSlug,
  type Role,
} from "@/lib/access";

type RoleCtx = {
  role: Role;
  roleLabel: string;
  /** Access mode for a menu, or undefined when hidden for this role. */
  access: (slug: MenuSlug) => AccessMode | undefined;
};

const Ctx = React.createContext<RoleCtx | null>(null);

/** Supplies the current (static) role to the shell + pages. One per role route. */
export function RoleProvider({
  role,
  children,
}: {
  role: Role;
  children: React.ReactNode;
}) {
  const value = React.useMemo<RoleCtx>(
    () => ({
      role,
      roleLabel: ROLE_LABELS[role],
      access: (slug) => accessOf(role, slug),
    }),
    [role]
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useRole(): RoleCtx {
  const v = React.useContext(Ctx);
  if (!v) throw new Error("useRole must be used within a RoleProvider");
  return v;
}
