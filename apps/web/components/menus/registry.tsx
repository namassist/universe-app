"use client";

import type { ComponentType } from "react";
import { notFound } from "next/navigation";

import type { AccessMode, MenuSlug } from "@/lib/access";
import { useRole } from "@/components/providers/role-context";

import { AttendanceMenu } from "./attendance";
import { DashboardMenu } from "./dashboard";
import { DatabaseUnitMenu } from "./database-unit";
import { DisplayAdminMenu } from "./display-admin";
import { EmployeesMenu } from "./employees";
import { FitToWorkMenu } from "./fit-to-work";
import { FleetAllocationMenu } from "./fleet-allocation";
import { FleetSettingMenu } from "./fleet-setting";
import { MasterMenu } from "./master";
import { MenuPlaceholder } from "./placeholder";
import { RosterApprovalMenu } from "./roster-approval";
import { RosterDataMenu } from "./roster-data";
import { RosterRevisionMenu } from "./roster-revision";
import { SettingMenu } from "./setting";
import { UmRolesMenu } from "./um-roles";
import { UmUsersMenu } from "./um-users";
import { UnitStatusMenu } from "./unit-status";

type MenuComponent = ComponentType<{ mode: AccessMode }>;

/**
 * slug → faithful static page. Filled in incrementally; any slug not present
 * falls back to <MenuPlaceholder>. Each route's `page.tsx` renders <MenuPage>.
 */
const REGISTRY: Partial<Record<MenuSlug, MenuComponent>> = {
  dashboard: DashboardMenu,
  "roster-data": RosterDataMenu,
  "roster-revision": RosterRevisionMenu,
  "roster-approval": RosterApprovalMenu,
  attendance: AttendanceMenu,
  employees: EmployeesMenu,
  "fit-to-work": FitToWorkMenu,
  "display-attendance": (p) => <DisplayAdminMenu {...p} kind="att" />,
  "display-fleet": (p) => <DisplayAdminMenu {...p} kind="fleet" />,
  /* display-fitwork & monitoring-fingerprint have no in-shell page: the
     sidebar buttons open their fullscreen kiosks (/display/*) in a new tab */
  "unit-status": UnitStatusMenu,
  "fleet-allocation": FleetAllocationMenu,
  "fleet-setting": FleetSettingMenu,
  "database-unit": DatabaseUnitMenu,
  "jenis-unit": (p) => <MasterMenu {...p} cat="jenis-unit" />,
  "model-unit": (p) => <MasterMenu {...p} cat="model-unit" />,
  "merk-unit": (p) => <MasterMenu {...p} cat="merk-unit" />,
  "kelas-unit": (p) => <MasterMenu {...p} cat="kelas-unit" />,
  simper: (p) => <MasterMenu {...p} cat="simper" />,
  departemen: (p) => <MasterMenu {...p} cat="departemen" />,
  "area-kerja": (p) => <MasterMenu {...p} cat="area-kerja" />,
  bus: (p) => <MasterMenu {...p} cat="bus" />,
  mess: (p) => <MasterMenu {...p} cat="mess" />,
  "running-text": (p) => <MasterMenu {...p} cat="running-text" />,
  sound: (p) => <MasterMenu {...p} cat="sound" />,
  timeline: (p) => <MasterMenu {...p} cat="timeline" />,
  users: UmUsersMenu,
  roles: UmRolesMenu,
  setting: SettingMenu,
};

/**
 * Resolves its own access mode from the session rather than taking it as a
 * prop. There is now one page per menu instead of one per role × menu, so a
 * build-time `mode` literal would have to name a role the URL no longer
 * carries — and the URL was never a trustworthy place to keep one.
 *
 * A slug the caller has no grant for renders not-found. That is presentation,
 * not protection: every request behind it is refused by the API independently.
 */
export function MenuPage({ slug }: { slug: MenuSlug }) {
  const { access } = useRole();
  const mode = access(slug);
  if (!mode) notFound();

  const Comp = REGISTRY[slug];
  if (Comp) return <Comp mode={mode} />;
  return <MenuPlaceholder slug={slug} mode={mode} />;
}
