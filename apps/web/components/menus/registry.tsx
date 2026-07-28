"use client";

import type { ComponentType } from "react";
import { notFound } from "next/navigation";

import type { AccessMode, MenuSlug } from "@/lib/access";
import { useRole } from "@/components/providers/role-context";

import { AttendanceMenu } from "./attendance";
import { BusMenu } from "./bus";
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
import { RunTextsMenu } from "./run-texts";
import { SettingMenu } from "./setting";
import { SoundsMenu } from "./sounds";
import { TimelineMenu } from "./timeline";
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
  "kode-simper": (p) => <MasterMenu {...p} cat="kode-simper" />,
  departemen: (p) => <MasterMenu {...p} cat="departemen" />,
  "area-kerja": (p) => <MasterMenu {...p} cat="area-kerja" />,
  mess: (p) => <MasterMenu {...p} cat="mess" />,
  perusahaan: (p) => <MasterMenu {...p} cat="perusahaan" />,
  jabatan: (p) => <MasterMenu {...p} cat="jabatan" />,
  /* Not catalogues: these four have their own tables and their own routes, and
     rode <MasterMenu> only because the static port needed a table with a
     dialog. Bus is a schedule on a unit, the other three are display content
     and the allocation schedule. */
  bus: BusMenu,
  "running-text": RunTextsMenu,
  sound: SoundsMenu,
  timeline: TimelineMenu,
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
