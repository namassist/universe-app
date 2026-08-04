/**
 * The FTW verdict source: savera's `saverawatch` database.
 *
 * savera computes and persists the per-operator, per-day fit-to-work decision
 * in `summary_insights_v2` (its own sync job keeps that table current), so
 * this fetcher reads finished verdicts — it never re-runs savera's sleep
 * categorization or fatigue math. `is_sync_data = false` keeps only rows the
 * operator uploaded themselves, which is what "has uploaded FTW" means.
 *
 * Everything time-shaped is selected as text: the source stores site-local
 * naive timestamps, and letting a driver "helpfully" attach a timezone shifts
 * the morning's facts by whatever the API server's clock offset happens to be.
 *
 * The connection is lazy and read-only at the session level. The account
 * should *also* be read-only — see `.env.example`.
 */

import postgres from "postgres";

import { env } from "../env";

export type FtwSourceRow = {
  /** Raw source NIK (`employees.code` in savera) — normalize before joining. */
  nik: string | null;
  name: string | null;
  company: string | null;
  department: string | null;
  position: string | null;
  mess: string | null;
  shift: string | null;
  /** `summaries.sleep` — the minutes savera's rules actually ran against. */
  sleep_minutes: number;
  sleep_category: string | null;
  ftw_decision: string | null;
  /** "YYYY-MM-DD HH:MM:SS", source-local. */
  sent_at: string | null;
  /** "YYYY-MM-DD" — the upload's send_date. */
  date: string;
};

export type FtwFetcher = (dates: string[]) => Promise<FtwSourceRow[]>;

let client: ReturnType<typeof postgres> | null = null;

function sql() {
  client ??= postgres(env.FTW_SOURCE_URL, {
    max: 1,
    connect_timeout: 5,
    // Ingest touches the source in bursts a few minutes a day; holding a
    // socket open between windows would be a standing claim on someone
    // else's database for nothing.
    idle_timeout: 30,
    connection: { default_transaction_read_only: true },
  });
  return client;
}

/**
 * Manual FTW uploads for the given dates, one row per person per date
 * (`DISTINCT ON` keeps the latest upload when someone uploads twice).
 */
export const fetchFtwRows: FtwFetcher = async (dates) => {
  if (!dates.length) return [];
  const rows = await sql()`
    select distinct on (e.code, si.send_date)
      e.code                                   as nik,
      e.fullname                               as name,
      c.name                                   as company,
      d.name                                   as department,
      e.position                               as position,
      m.name                                   as mess,
      sh.name                                  as shift,
      coalesce(s.sleep, 0)::int                as sleep_minutes,
      si.base_work_category                    as sleep_category,
      si.ftw_decision_label                    as ftw_decision,
      s.send_date::text || ' ' || coalesce(s.send_time::text, '00:00:00')
                                               as sent_at,
      si.send_date::text                       as date
    from summary_insights_v2 si
    join summaries s on s.id = si.summary_id
    left join employees e
      on e.id = s.employee_id
      or (e.user_id = s.user_id and s.employee_id is null)
    left join companies c on c.id = s.company_id
    left join departments d on d.id = s.department_id
    left join messes m on m.id = e.mess_id
    left join shifts sh on sh.id = s.shift_id
    where si.send_date = any(${dates}::date[])
      and si.is_sync_data = false
      and si.company_id = ${env.FTW_SOURCE_COMPANY_ID}
    order by e.code, si.send_date, s.send_time desc nulls last
  `;
  return rows as unknown as FtwSourceRow[];
};

/** For tests and graceful shutdown. */
export async function closeFtwSource(): Promise<void> {
  if (!client) return;
  await client.end({ timeout: 3 });
  client = null;
}
