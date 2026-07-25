/**
 * Master area kerja — sumber tunggal dipakai master menu (`area-kerja`) dan
 * Setting Fleet (dropdown lokasi kerja). Tipe hanya Mining / Non Mining.
 * (App statis, data contoh.)
 */

export type AreaKerja = {
  id: string;
  name: string;
  tipe: "Mining" | "Non Mining";
};

export const AREA_TIPE = ["Mining", "Non Mining"];

export const AREA_KERJA: AreaKerja[] = [
  { id: "a1", name: "Panel East Puncak Utara", tipe: "Mining" },
  { id: "a2", name: "Panel East Puncak Selatan", tipe: "Mining" },
  { id: "a3", name: "Panel East Tengah", tipe: "Mining" },
  { id: "a4", name: "Panel East Bawah", tipe: "Mining" },
  { id: "a5", name: "Kasturi Puncak", tipe: "Mining" },
  { id: "a6", name: "Kasturi Tengah", tipe: "Mining" },
  { id: "a7", name: "Kasturi Bawah", tipe: "Mining" },
  { id: "a8", name: "High Dump", tipe: "Mining" },
  { id: "a9", name: "Low Wall", tipe: "Mining" },
  { id: "a10", name: "Ambalat", tipe: "Mining" },
  { id: "a11", name: "Mandalika", tipe: "Mining" },
  { id: "a12", name: "Disposal T4", tipe: "Mining" },
  { id: "a13", name: "CPP33", tipe: "Non Mining" },
  { id: "a14", name: "Workshop", tipe: "Non Mining" },
  { id: "a15", name: "Pondok Kontainer", tipe: "Non Mining" },
  { id: "a16", name: "V Point", tipe: "Non Mining" },
  { id: "a17", name: "Parkiran T6", tipe: "Non Mining" },
  { id: "a18", name: "Parkiran Sebatik", tipe: "Non Mining" },
  { id: "a19", name: "Parkiran Panel East", tipe: "Non Mining" },
  { id: "a20", name: "Stock Room T6", tipe: "Non Mining" },
  { id: "a21", name: "Readyline", tipe: "Non Mining" },
  { id: "a22", name: "Bank Soil", tipe: "Mining" },
  { id: "a23", name: "Parkiran Wash Bay", tipe: "Non Mining" },
];

export const AREA_KERJA_NAMES = AREA_KERJA.map((a) => a.name);

/** Area kerja bertipe Mining — lokasi operasi fleet. */
export const AREA_MINING_NAMES = AREA_KERJA.filter(
  (a) => a.tipe === "Mining"
).map((a) => a.name);
