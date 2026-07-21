import type { ComponentType } from "react";

import type { AccessMode, MenuSlug } from "@/lib/access";

import { DashboardMenu } from "./dashboard";
import { DisplayAdminMenu } from "./display-admin";
import { MasterMenu } from "./master";
import { MenuPlaceholder } from "./placeholder";
import { RosterDataMenu } from "./roster-data";
import { SettingMenu } from "./setting";

type MenuComponent = ComponentType<{ mode: AccessMode }>;

/**
 * slug → faithful static page. Filled in incrementally; any slug not present
 * falls back to <MenuPlaceholder>. Each role's `page.tsx` renders <MenuPage>.
 */
const REGISTRY: Partial<Record<MenuSlug, MenuComponent>> = {
  dashboard: DashboardMenu,
  "roster-data": RosterDataMenu,
  "display-attendance": (p) => <DisplayAdminMenu {...p} kind="att" />,
  "display-fleet": (p) => <DisplayAdminMenu {...p} kind="fleet" />,
  /* display-fitwork & monitoring-fingerprint have no in-shell page: the
     sidebar buttons open their fullscreen kiosks (/display/*) in a new tab */
  "area-kerja": (p) => <MasterMenu {...p} cat="area-kerja" />,
  bus: (p) => <MasterMenu {...p} cat="bus" />,
  "lokasi-excavator": (p) => <MasterMenu {...p} cat="lokasi-excavator" />,
  "running-text": (p) => <MasterMenu {...p} cat="running-text" />,
  setting: SettingMenu,
};

export function MenuPage({ slug, mode }: { slug: MenuSlug; mode: AccessMode }) {
  const Comp = REGISTRY[slug];
  if (Comp) return <Comp mode={mode} />;
  return <MenuPlaceholder slug={slug} mode={mode} />;
}
