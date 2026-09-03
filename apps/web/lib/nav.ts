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
  /**
   * The heading this leaf begins a run under.
   *
   * Carried by the leaf rather than held in a separate list of headings so
   * that access filtering needs no second pass: the sidebar draws a heading
   * only when a *visible* child announces one, and a section whose every menu
   * is hidden from this role leaves no orphaned label behind.
   */
  section?: string;
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

/**
 * Tag a run of menus with the heading they sit under.
 *
 * *Every* leaf carries it, not just the first: access filtering removes
 * individual menus, so a section whose opening menu this role cannot see would
 * otherwise lose its heading and leave the rest of its run hanging under the
 * previous one.
 */
const section = (section: string, ...slugs: MenuSlug[]): NavLeaf[] =>
  slugs.map((slug) => ({ ...leaf(slug), section }));
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
    /*
     * Seventeen menus in one flat list, in no order anyone could predict —
     * `merk-unit` sat between `model-unit` and `kelas-unit`, `perusahaan`
     * after `mess`. Sections group them by the thing they describe, so
     * finding one is a matter of knowing what it is rather than remembering
     * where it landed.
     *
     * Headings, not nested groups: a second level of expanding would put every
     * catalogue two clicks away and hide which sections exist until you open
     * them. The order within a section is alphabetical, except the
     * organisation chain, which reads the way it nests — a company owns
     * departments, a department owns positions.
     */
    children: [
      ...section(
        "Unit",
        "database-unit",
        "jenis-unit",
        "kelas-unit",
        "merk-unit",
        "model-unit"
      ),
      ...section("Organisasi", "perusahaan", "departemen", "jabatan"),
      ...section("SIMPER", "simper", "kode-simper"),
      ...section("Lokasi & Fasilitas", "bus", "mess"),
      ...section(
        "Perangkat & Konten",
        "mesin-fingerprint",
        "running-text",
        "sound"
      ),
      ...section("Jadwal", "timeline"),
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
