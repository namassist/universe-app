/**
 * Master Departemen — SATU sumber dipakai bersama oleh master menu, form Unit,
 * dan form/list Karyawan supaya penamaannya konsisten. Data statis, no state.
 */

export const DEPARTEMEN = [
  { name: "Mining Operation", desc: "Operasi penambangan" },
  { name: "Pit Service", desc: "Layanan pit" },
  { name: "Plant", desc: "Perawatan alat" },
  { name: "SDI", desc: "Sumber Daya Insani" },
  { name: "HRGA", desc: "HR & General Affairs" },
];

/** Nama departemen saja — untuk opsi dropdown & filter. */
export const DEPARTEMEN_NAMES = DEPARTEMEN.map((d) => d.name);
