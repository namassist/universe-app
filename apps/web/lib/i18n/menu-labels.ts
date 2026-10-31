import type { MenuSlug } from "@universe/contracts";

import type { Dict } from "./id";

/**
 * The dictionary entry naming each menu.
 *
 * `MENU_LABELS` in `@universe/contracts` stays the one-language reference the
 * other apps read; the web reads its menus from here so the sidebar, the
 * breadcrumb and every page title follow the language switch.
 */
const MENU_KEYS: Record<MenuSlug, keyof Dict> = {
  dashboard: "mnDashboard",
  "display-attendance": "mnDisplayAttendance",
  "display-fleet": "mnDisplayFleet",
  "display-fitwork": "mnDisplayFitwork",
  "monitoring-fingerprint": "mnMonitoringFingerprint",
  "monitoring-tap": "mnMonitoringTap",
  "scan-id": "mnScanId",
  employees: "mnEmployees",
  "roster-data": "mnRosterData",
  "roster-correction": "mnRosterCorrection",
  attendance: "mnAttendance",
  tiket: "mnTiket",
  "fit-to-work": "mnFitToWork",
  "unit-status": "mnUnitStatus",
  "fleet-allocation": "mnFleetAllocation",
  "fleet-setting": "mnFleetSetting",
  "allocation-priority": "mnAllocationPriority",
  report: "mnReport",
  leaderboard: "mnLeaderboard",
  "database-unit": "mnDatabaseUnit",
  "jenis-unit": "mnJenisUnit",
  "model-unit": "mnModelUnit",
  "merk-unit": "mnMerkUnit",
  "kelas-unit": "mnKelasUnit",
  simper: "mnSimper",
  "kode-simper": "mnKodeSimper",
  departemen: "mnDepartemen",
  bus: "mnBus",
  mess: "mnMess",
  perusahaan: "mnPerusahaan",
  jabatan: "mnJabatan",
  "running-text": "mnRunningText",
  sound: "mnSound",
  timeline: "mnTimeline",
  "mesin-fingerprint": "mnMesinFingerprint",
  "mesin-printer": "mnMesinPrinter",
  users: "mnUsers",
  roles: "mnRoles",
  setting: "mnSetting",
  notifications: "mnNotifications",
  integrations: "mnIntegrations",
};

export const menuLabelKey = (slug: MenuSlug): keyof Dict => MENU_KEYS[slug];

export const menuLabel = (t: Dict, slug: MenuSlug): string =>
  t[MENU_KEYS[slug]];
