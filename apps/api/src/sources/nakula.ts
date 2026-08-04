/**
 * The fingerprint source: Nakula's raw tap log, `tbl_absen_all`.
 *
 * One row there per individual tap (nik, date, IN/OUT button, timestamp,
 * device IP). This fetcher reduces the log to first-IN / first-OUT per person
 * per day and nothing more — raw as recorded, wrong buttons included. Which
 * taps *mean* presence for a shift needs the roster and belongs to the
 * consumer, not the snapshot.
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
  /** "YYYY-MM-DD HH:MM:SS", source-local; null when no IN tap yet. */
  first_in_at: string | null;
  first_in_ip: string | null;
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
    with first_in as (
      select distinct on (nik, tanggal)
        nik, tanggal, finger_date, finger_ip
      from tbl_absen_all
      where tanggal = any(${dates}::date[]) and status_kerja = 'IN'
      order by nik, tanggal, finger_date asc
    ),
    first_out as (
      select distinct on (nik, tanggal)
        nik, tanggal, finger_date, finger_ip
      from tbl_absen_all
      where tanggal = any(${dates}::date[]) and status_kerja = 'OUT'
      order by nik, tanggal, finger_date asc
    )
    select
      coalesce(i.nik, o.nik)                   as nik,
      coalesce(i.tanggal, o.tanggal)::text     as date,
      i.finger_date::text                      as first_in_at,
      i.finger_ip                              as first_in_ip,
      o.finger_date::text                      as first_out_at,
      o.finger_ip                              as first_out_ip
    from first_in i
    full outer join first_out o
      on i.nik = o.nik and i.tanggal = o.tanggal
  `;
  return rows as unknown as FingerSourceRow[];
};

/** For tests and graceful shutdown. */
export async function closeFingerSource(): Promise<void> {
  if (!client) return;
  await client.end({ timeout: 3 });
  client = null;
}
