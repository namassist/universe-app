import {
  CalendarDays,
  Database,
  FileSpreadsheet,
  Heart,
  LayoutDashboard,
  Monitor,
  Settings,
  Truck,
  UserPlus,
  Users,
  type LucideIcon,
} from "lucide-react";

import type { MenuSlug } from "./access";
import type { Dict } from "./i18n";

/* Labels are dictionary keys, read through `t` at render: a leaf's name is
   its menu's (`menuLabel`), a group's and a section's are their own. */
export type NavLeaf = {
  slug: MenuSlug;
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
  section?: keyof Dict;
};
export type NavEntry =
  | { kind: "item"; slug: MenuSlug; icon: LucideIcon }
  | {
      kind: "group";
      key: string;
      label: keyof Dict;
      icon: LucideIcon;
      children: NavLeaf[];
    };

const leaf = (slug: MenuSlug): NavLeaf => ({ slug });

/**
 * Tag a run of menus with the heading they sit under.
 *
 * *Every* leaf carries it, not just the first: access filtering removes
 * individual menus, so a section whose opening menu this role cannot see would
 * otherwise lose its heading and leave the rest of its run hanging under the
 * previous one.
 */
const section = (section: keyof Dict, ...slugs: MenuSlug[]): NavLeaf[] =>
  slugs.map((slug) => ({ ...leaf(slug), section }));
const item = (slug: MenuSlug, icon: LucideIcon): NavEntry => ({
  kind: "item",
  slug,
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
    label: "mnGrpDisplay",
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
    label: "mnGrpRoster",
    icon: CalendarDays,
    /* The monitor sits beside Attendance rather than beside the machine
       health screen: it is read while asking about a person, not about a
       machine. Attendance gives the answer, this gives the working. */
    children: [
      leaf("roster-data"),
      /* Beside the roster it corrects: the screen an admin opens when the
         03:00 pull still has somebody on the wrong shift. */
      leaf("roster-correction"),
      leaf("attendance"),
      leaf("monitoring-tap"),
      leaf("tiket"),
      /* Beside Attendance because it is read while asking about a person at
         the gate — who is this, and what did the muster give him. */
      leaf("scan-id"),
    ],
  },
  item("fit-to-work", Heart),
  {
    kind: "group",
    key: "asset",
    label: "mnGrpAsset",
    icon: Truck,
    children: [
      leaf("unit-status"),
      leaf("fleet-allocation"),
      leaf("fleet-setting"),
      leaf("allocation-priority"),
    ],
  },
  /* A menu of its own rather than a leaf under Asset & Fleet: the reports
     read the muster as a whole — the FTW and the finger as much as the fleet —
     and they are opened by roles that see none of the fleet screens. */
  item("report", FileSpreadsheet),
  {
    kind: "group",
    key: "master",
    label: "mnGrpMaster",
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
        "mnSecUnit",
        "database-unit",
        "jenis-unit",
        "kelas-unit",
        "merk-unit",
        "model-unit"
      ),
      ...section("mnSecOrg", "perusahaan", "departemen", "jabatan"),
      ...section("mnSecSimper", "simper", "kode-simper"),
      ...section("mnSecPlace", "bus", "mess"),
      ...section(
        "mnSecDevice",
        "mesin-fingerprint",
        "mesin-printer",
        "running-text",
        "sound"
      ),
      ...section("mnSecSchedule", "timeline"),
    ],
  },
  {
    kind: "group",
    key: "um",
    label: "mnGrpUm",
    icon: UserPlus,
    /* Integrasi API sits with the accounts because it is the same question —
       who may read from Universe — asked of a service rather than a person. */
    children: [leaf("users"), leaf("roles"), leaf("integrations")],
  },
  item("setting", Settings),
];
