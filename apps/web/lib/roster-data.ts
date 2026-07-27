import type { Lang } from "@/lib/i18n";

/**
 * Static roster data shared by the Data Roster list, the upload preview, and
 * the document detail grid — data-only module, no state.
 */

export type RosterDoc = {
  key: string;
  label: string;
  file: string;
  dept: string;
  by: string;
  date: string;
  dateISO: string;
  emp: number;
  rows: number;
  month: string; // YYYY-MM
  status: "aktif" | "arsip";
};

export const ROSTER_DOCS: RosterDoc[] = [
  {
    key: "r1",
    label: "Roster Juli 2026",
    file: "roster-hauling-2607.xlsx",
    dept: "Hauling",
    by: "Admin Hauling",
    date: "01 Jul 2026",
    dateISO: "2026-07-01",
    emp: 64,
    rows: 1984,
    month: "2026-07",
    status: "aktif",
  },
  {
    key: "r2",
    label: "Roster Juli 2026",
    file: "roster-loading-2607.xlsx",
    dept: "Loading",
    by: "Admin Loading",
    date: "01 Jul 2026",
    dateISO: "2026-07-01",
    emp: 28,
    rows: 868,
    month: "2026-07",
    status: "aktif",
  },
  {
    key: "r3",
    label: "Roster Juni 2026",
    file: "roster-hauling-2606.xlsx",
    dept: "Hauling",
    by: "Admin Hauling",
    date: "01 Jun 2026",
    dateISO: "2026-06-01",
    emp: 62,
    rows: 1860,
    month: "2026-06",
    status: "arsip",
  },
  {
    key: "r4",
    label: "Roster Juni 2026",
    file: "roster-support-2606.xlsx",
    dept: "Support",
    by: "Admin Support",
    date: "02 Jun 2026",
    dateISO: "2026-06-02",
    emp: 18,
    rows: 540,
    month: "2026-06",
    status: "arsip",
  },
];

export function findRosterDoc(key: string | null): RosterDoc {
  return ROSTER_DOCS.find((d) => d.key === key) ?? ROSTER_DOCS[0]!;
}

/* ===== Legenda kode roster ===== */
export type LegendGroup = { label: string; codes: { k: string; v: string }[] };

export function legendGroupsFor(lang: Lang): LegendGroup[] {
  const en = lang === "en";
  return [
    {
      label: en ? "Shifts & attendance" : "Shift & kehadiran",
      codes: [
        { k: "D", v: "Day shift" },
        { k: "N", v: "Night shift" },
        { k: "R", v: en ? "Regular" : "Reguler" },
        { k: "STB", v: "Standby" },
        { k: "OFF", v: "OFF" },
      ],
    },
    {
      label: en ? "Leave & permits" : "Cuti & izin",
      codes: [
        { k: "CR", v: en ? "Roster leave" : "Cuti roster" },
        { k: "AL", v: "Annual leave" },
        { k: "LWP", v: en ? "Paid leave" : "Izin dengan upah" },
        { k: "LWOP", v: en ? "Unpaid leave" : "Izin tanpa upah" },
        { k: "PH", v: "Public holiday" },
        { k: "PHD", v: en ? "Public holiday (day)" : "Public holiday siang" },
      ],
    },
    {
      label: en ? "Sickness & absence" : "Sakit & ketidakhadiran",
      codes: [
        { k: "S", v: en ? "Sick" : "Sakit" },
        { k: "A", v: en ? "Alpha / no notice" : "Alpha" },
      ],
    },
    {
      label: en ? "Medical & quarantine" : "Medis & karantina",
      codes: [
        { k: "MCU", v: "Medical check up" },
        { k: "MCR", v: en ? "Regular MCU" : "Reguler MCU" },
        { k: "MCUF", v: en ? "MCU follow-up" : "Follow up MCU" },
        { k: "ISM", v: en ? "Self-isolation" : "Isolasi mandiri" },
        { k: "OBC", v: en ? "COVID observation" : "Observasi COVID" },
        { k: "KRT", v: en ? "Quarantine" : "Karantina" },
      ],
    },
    {
      label: en ? "Assignment & training" : "Tugas & training",
      codes: [
        { k: "TGS", v: en ? "Assignment" : "Tugas" },
        { k: "DNS", v: en ? "Official duty" : "Dinas" },
        { k: "TRV", v: "Travel" },
        { k: "TR", v: en ? "Off-site training" : "Training di luar site" },
        { k: "TRS", v: en ? "On-site training" : "Training onsite" },
        { k: "IN", v: en ? "Induction" : "Induksi" },
      ],
    },
    {
      label: en ? "Employment status" : "Status kepegawaian",
      codes: [
        { k: "TERM", v: "Termination" },
        { k: "EOC", v: en ? "Contract ended" : "Kontrak berakhir" },
        { k: "RSG", v: "Resign" },
      ],
    },
  ];
}

/* ===== Grid kode harian (preview upload & detail dokumen) ===== */

/** Warna sel kode roster. */
export function rosterCodeColor(c: string): string {
  if (["OFF", "CR", "AL", "LWP", "LWOP", "PH", "PHD"].includes(c))
    return "var(--text-tertiary)";
  if (["S", "A", "ISM", "OBC", "KRT", "TERM", "RSG", "EOC"].includes(c))
    return "var(--color-danger-text)";
  if (c === "N") return "var(--color-primary-bright)";
  return "var(--text-secondary)";
}

const CREW: { nik: string; name: string }[] = [
  { nik: "503220421", name: "Budi Santoso" },
  { nik: "508210388", name: "Andi Wijaya" },
  { nik: "501230510", name: "Rudi Hartono" },
  { nik: "505200233", name: "Sari Lestari" },
  { nik: "511190111", name: "Joko Prasetyo" },
  { nik: "509220290", name: "Dewi Anggraini" },
  { nik: "502210367", name: "Hendra Gunawan" },
  { nik: "506230455", name: "Fitri Handayani" },
  { nik: "504180129", name: "Agus Salim" },
  { nik: "510200602", name: "Rina Marlina" },
  { nik: "507230715", name: "Bagus Priyambodo" },
  { nik: "507230733", name: "Lina Kusuma" },
];

export type RosterGrid = {
  days: string[];
  rows: { nik: string; name: string; codes: { v: string; color: string }[] }[];
};

/**
 * Matriks kode harian statis: pola mingguan D/N per paritas NIK + OFF
 * bergilir, dengan sisipan realistis (sakit, alpha, MCU) di tengah bulan.
 */
export function rosterGrid(month = "2026-07", monLabel = "Jul"): RosterGrid {
  const dim = new Date(
    Number(month.slice(0, 4)),
    Number(month.slice(5, 7)),
    0
  ).getDate();
  const OVERRIDE: Record<string, Record<number, string>> = {
    "501230510": { 14: "S" },
    "504180129": { 9: "A" },
    "509220290": { 21: "MCU" },
  };
  const days = Array.from(
    { length: dim },
    (_, i) => `${String(i + 1).padStart(2, "0")} ${monLabel}`
  );
  const rows = CREW.map((e, i) => {
    const base = Number(e.nik.slice(-1)) % 2 === 0 ? "D" : "N";
    const week: string[] = Array.from({ length: 7 }, () => base);
    week[(i + 5) % 7] = "OFF";
    week[(i + 6) % 7] = "OFF";
    const codes = [];
    for (let d = 1; d <= dim; d++) {
      const c = OVERRIDE[e.nik]?.[d] ?? week[(d - 1) % 7]!;
      codes.push({ v: c, color: rosterCodeColor(c) });
    }
    return { nik: e.nik, name: e.name, codes };
  });
  return { days, rows };
}

/* ===== Baris error hasil validasi upload ===== */
export type UpError = {
  row: string;
  nik: string;
  emp: string;
  issue: string;
  badgeVariant: "danger" | "warning";
  badge: string;
};

export function upErrorRows(lang: Lang): UpError[] {
  const en = lang === "en";
  return [
    {
      row: "214",
      nik: "512259998",
      emp: "—",
      issue: en
        ? "NIK not found in employee data"
        : "NIK tidak terdaftar di data karyawan",
      badgeVariant: "danger",
      badge: "Error",
    },
    {
      row: "387",
      nik: "501230510",
      emp: "Rudi Hartono",
      issue: en
        ? 'Code "D12" on 14 Jul — not a known roster code'
        : 'Kode "D12" pada 14 Jul — bukan kode roster yang dikenal',
      badgeVariant: "danger",
      badge: "Error",
    },
    {
      row: "512",
      nik: "506230455",
      emp: "Fitri Handayani",
      issue: en
        ? "Day 31 empty — every day must have a code"
        : "Tanggal 31 kosong — semua hari wajib berkode",
      badgeVariant: "danger",
      badge: "Error",
    },
    {
      row: "890",
      nik: "507230733",
      emp: "Lina Kusuma",
      issue: en
        ? 'NIK is not numeric ("5O723O733" — letter O)'
        : 'Format NIK bukan angka ("5O723O733" — huruf O)',
      badgeVariant: "danger",
      badge: "Error",
    },
    {
      row: en ? "1,204" : "1.204",
      nik: "502210367",
      emp: "Hendra Gunawan",
      issue: en
        ? "N consecutive > 14 days — violates roster rules"
        : "N berurutan > 14 hari — melanggar aturan roster",
      badgeVariant: "danger",
      badge: "Error",
    },
    {
      row: "640 & 641",
      nik: "509220290",
      emp: "Dewi Anggraini",
      issue: en
        ? "Duplicate rows — row 641 is used"
        : "Baris ganda — baris 641 yang dipakai",
      badgeVariant: "warning",
      badge: en ? "Duplicate" : "Duplikat",
    },
  ];
}

/* ===== Kode pilihan form revisi ===== */
export function revCodeList(lang: Lang): string[] {
  return legendGroupsFor(lang).flatMap((g) =>
    g.codes.map((c) => `${c.k} — ${c.v}`)
  );
}
