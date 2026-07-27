import {
  CalendarDays,
  Database,
  Heart,
  LayoutDashboard,
  Monitor,
  Settings,
  Truck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import { MENU_LABELS, type MenuSlug } from "./access";

export type NavLeaf = {
  slug: MenuSlug;
  label: string;
  /* kiosk screens open in a new tab (openDisplay) instead of routing */
  displayUrl?: string;
};
export type NavEntry =
  | { kind: "item"; slug: MenuSlug; label: string; icon: LucideIcon }
  | {
      kind: "group";
      key: string;
      label: string;
      icon: LucideIcon;
      children: NavLeaf[];
    };

const leaf = (slug: MenuSlug): NavLeaf => ({ slug, label: MENU_LABELS[slug] });
const item = (slug: MenuSlug, icon: LucideIcon): NavEntry => ({
  kind: "item",
  slug,
  label: MENU_LABELS[slug],
  icon,
});

/**
 * The full navigation tree. The sidebar filters
 * this by the current role's access and hides empty groups; hrefs are made
 * role-relative (`/{role}/{slug}`) at render time.
 */
export const NAV: NavEntry[] = [
  item("dashboard", LayoutDashboard),
  {
    kind: "group",
    key: "display",
    label: "Display",
    icon: Monitor,
    children: [
      leaf("display-attendance"),
      leaf("display-fleet"),
      { ...leaf("display-fitwork"), displayUrl: "/display/fitwork" },
      { ...leaf("monitoring-fingerprint"), displayUrl: "/display/fingerprint" },
    ],
  },
  item("employees", Users),
  {
    kind: "group",
    key: "roster",
    label: "Roster & Attendance",
    icon: CalendarDays,
    children: [
      leaf("roster-data"),
      leaf("roster-revision"),
      leaf("roster-approval"),
      leaf("attendance"),
    ],
  },
  item("fit-to-work", Heart),
  {
    kind: "group",
    key: "asset",
    label: "Asset & Fleet",
    icon: Truck,
    children: [
      leaf("unit-status"),
      leaf("fleet-allocation"),
      leaf("fleet-setting"),
    ],
  },
  {
    kind: "group",
    key: "master",
    label: "Master",
    icon: Database,
    children: [
      leaf("database-unit"),
      leaf("jenis-unit"),
      leaf("model-unit"),
      leaf("merk-unit"),
      leaf("kelas-unit"),
      leaf("simper"),
      leaf("kode-simper"),
      leaf("departemen"),
      leaf("area-kerja"),
      leaf("bus"),
      leaf("mess"),
      leaf("running-text"),
      leaf("sound"),
      leaf("timeline"),
    ],
  },
  {
    kind: "group",
    key: "um",
    label: "User Management",
    icon: UserPlus,
    children: [leaf("users"), leaf("roles")],
  },
  item("setting", Settings),
];
