"use client";

import * as React from "react";

/**
 * Notifikasi in-app (statis) — satu state modul dipakai dropdown topbar DAN
 * halaman notifikasi sekaligus, supaya badge & daftar selalu sinkron.
 * Reset saat hard reload (static-only).
 */

export type NotifTone = "info" | "success" | "warning" | "danger";

export const notifToneDot: Record<NotifTone, string> = {
  info: "bg-(--color-primary)",
  success: "bg-(--badge-success-text)",
  warning: "bg-(--badge-warning-text)",
  danger: "bg-(--color-danger)",
};

export type Notif = {
  id: string;
  tone: NotifTone;
  textId: string;
  textEn: string;
  timeId: string;
  timeEn: string;
  read: boolean;
};

const INITIAL: Notif[] = [
  {
    id: "n1",
    tone: "warning",
    textId: "3 revisi roster menunggu approval",
    textEn: "3 roster revisions awaiting approval",
    timeId: "5 menit lalu",
    timeEn: "5 minutes ago",
    read: false,
  },
  {
    id: "n2",
    tone: "danger",
    textId: "Unit DT-104 berstatus Breakdown",
    textEn: "Unit DT-104 is in Breakdown status",
    timeId: "32 menit lalu",
    timeEn: "32 minutes ago",
    read: false,
  },
  {
    id: "n3",
    tone: "success",
    textId: "Upload roster Juli berhasil diproses",
    textEn: "July roster upload processed successfully",
    timeId: "1 jam lalu",
    timeEn: "1 hour ago",
    read: false,
  },
  {
    id: "n4",
    tone: "warning",
    textId: "2 operator kurang tidur pada shift pagi",
    textEn: "2 operators under-slept on the day shift",
    timeId: "2 jam lalu",
    timeEn: "2 hours ago",
    read: true,
  },
  {
    id: "n5",
    tone: "danger",
    textId: "Display Gate B offline — heartbeat terakhir 6 menit lalu",
    textEn: "Display Gate B offline — last heartbeat 6 minutes ago",
    timeId: "3 jam lalu",
    timeEn: "3 hours ago",
    read: false,
  },
  {
    id: "n6",
    tone: "info",
    textId: "ACTUAL shift pagi 21 Jul telah digenerate",
    textEn: "Day-shift ACTUAL for 21 Jul has been generated",
    timeId: "4 jam lalu",
    timeEn: "4 hours ago",
    read: true,
  },
  {
    id: "n7",
    tone: "warning",
    textId: "SIMPER Rudi Hartono kedaluwarsa 18 Jul",
    textEn: "Rudi Hartono's SIMPER expired on 18 Jul",
    timeId: "Kemarin",
    timeEn: "Yesterday",
    read: true,
  },
  {
    id: "n8",
    tone: "info",
    textId: "Karyawan baru ditambahkan: Lina Kusuma",
    textEn: "New employee added: Lina Kusuma",
    timeId: "Kemarin",
    timeEn: "Yesterday",
    read: true,
  },
];

let state: Notif[] = INITIAL;
const listeners = new Set<() => void>();
const emit = () => {
  for (const l of listeners) l();
};
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

export const notifStore = {
  read(id: string) {
    state = state.map((n) => (n.id === id ? { ...n, read: true } : n));
    emit();
  },
  readAll() {
    state = state.map((n) => ({ ...n, read: true }));
    emit();
  },
};

export function useNotifs(): Notif[] {
  return React.useSyncExternalStore(
    subscribe,
    () => state,
    () => INITIAL
  );
}
