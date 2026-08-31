/**
 * The fingerprint source: Nakula's raw tap log, `tbl_absen_all`.
 *
 * One row there per individual tap (nik, date, IN/OUT button, timestamp,
 * device IP). This fetcher reduces the log to first-IN / first-OUT per person
 * per day and nothing more — raw as recorded, wrong buttons included. Which
 * taps *mean* presence for a shift needs the roster and belongs to the
 * consumer, not the snapshot.
 *
 * The one interpretation made here is the noon split of the IN tap, and it is
 * made because a day holds two shift-starts. Taking the earliest IN of the
 * calendar day let a night worker's wrong-button tap at 06:20 stand as their
 * arrival for that evening's shift (owner, 2026-08-30). Noon is a fixed hour
 * rather than the configured `finger-in` stage: no stage marks where a night
 * begins, and the two tap clusters — 04:00–07:00 and 15:00–18:00 — leave a
 * six-hour gap that no plausible gate moves across.
 *
 * Deliberately NOT Nakula's interpreted view (`vw_in_out_karyawan_new_new`):
 * the view rebuilds two months of correction logic on every query (~30s); the
 * indexed raw table answers the same dates in milliseconds.
 *
 * Times are selected as text for the same reason as in `savera.ts`.
 */

import postgres from "postgres";

import { env } from "../env";

export type FingerSourceRow = {
  /** Raw source NIK — normalize before joining. */
  nik: string | null;
  /** "YYYY-MM-DD" — the tap log's own day bucket. */
  date: string;
  /** First IN before 12:00. "YYYY-MM-DD HH:MM:SS", source-local. */
  first_in_at: string | null;
  first_in_ip: string | null;
  /** First IN at or after 12:00 — a night shift's arrival. */
  first_in_pm_at: string | null;
  first_in_pm_ip: string | null;
  first_out_at: string | null;
  first_out_ip: string | null;
};

export type FingerFetcher = (dates: string[]) => Promise<FingerSourceRow[]>;

let client: ReturnType<typeof postgres> | null = null;

function sql() {
  client ??= postgres(env.ATTENDANCE_SOURCE_URL, {
    max: 1,
    connect_timeout: 5,
    // Same reasoning as savera.ts: burst use, no standing sockets.
    idle_timeout: 30,
    connection: { default_transaction_read_only: true },
  });
  return client;
}

export const fetchFingerRows: FingerFetcher = async (dates) => {
  if (!dates.length) return [];
  const rows = await sql()`
    with taps as (
      select nik, tanggal, finger_date, finger_ip, status_kerja
      from tbl_absen_all
      where tanggal = any(${dates}::date[])
    ),
    keys as (select distinct nik, tanggal from taps),
    first_in_am as (
      select distinct on (nik, tanggal)
        nik, tanggal, finger_date, finger_ip
      from taps
      where status_kerja = 'IN' and finger_date::time < '12:00:00'
      order by nik, tanggal, finger_date asc
    ),
    first_in_pm as (
      select distinct on (nik, tanggal)
        nik, tanggal, finger_date, finger_ip
      from taps
      where status_kerja = 'IN' and finger_date::time >= '12:00:00'
      order by nik, tanggal, finger_date asc
    ),
    first_out as (
      select distinct on (nik, tanggal)
        nik, tanggal, finger_date, finger_ip
      from taps
      where status_kerja = 'OUT'
      order by nik, tanggal, finger_date asc
    )
    select
      k.nik                        as nik,
      k.tanggal::text              as date,
      am.finger_date::text         as first_in_at,
      am.finger_ip                 as first_in_ip,
      pm.finger_date::text         as first_in_pm_at,
      pm.finger_ip                 as first_in_pm_ip,
      o.finger_date::text          as first_out_at,
      o.finger_ip                  as first_out_ip
    from keys k
    left join first_in_am am on am.nik = k.nik and am.tanggal = k.tanggal
    left join first_in_pm pm on pm.nik = k.nik and pm.tanggal = k.tanggal
    left join first_out  o  on  o.nik = k.nik and  o.tanggal = k.tanggal
  `;
  return rows as unknown as FingerSourceRow[];
};

/** For tests and graceful shutdown. */
export async function closeFingerSource(): Promise<void> {
  if (!client) return;
  await client.end({ timeout: 3 });
  client = null;
}
