/**
 * The FTW verdict source: savera's `saverawatch` database.
 *
 * savera computes and persists the per-operator, per-day fit-to-work decision
 * in `summary_insights_v2` (its own sync job keeps that table current), so
 * this fetcher reads finished verdicts — it never re-runs savera's sleep
 * categorization or fatigue math.
 *
 * **Which rows count as "the operator uploaded their FTW" is savera's own
 * question, and the answer is its health monitor, not a column.** That page
 * (`MonitorController::health`) ignores the stored `is_sync_data` entirely and
 * re-derives it per row from `mobile_upload_batches`: a batch whose `source` is
 * `summary` or `detail` is a person pressing upload, anything else is the
 * background job. It then keeps only rows that carry an actual questionnaire —
 * a submission timestamp, or any of the three answers. This query asks both of
 * those the same way, so our count and the page's are the same count.
 *
 * The column was the obvious thing to trust and it is wrong often enough to
 * matter: `summary_insights_v2.is_sync_data` is written once, when the insight
 * row is inserted, and a manual upload landing seconds later never rewrites it.
 * On 2026-09-03's shift 1 that cost 14 of 366 readings — every one of them a
 * person who had answered, filed under "never uploaded".
 *
 * `ftw_decision_label` in that same table goes stale for exactly the same
 * reason, and savera's page does not read it either: `getInsightData` spots the
 * combination (a questionnaire is present, the label still says "Belum mengisi
 * FTW") under the name `isStaleFtwInsight` and recomputes. So the verdict here
 * is read from the three answers, which are the operator's own and cannot go
 * stale, under savera's rule from `resolveFitToWorkDecision`: q1 not yes, q2
 * not yes, q3 yes is "FTW aman"; anything else needs a follow-up.
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
  /** savera's verdict wording, computed here from the answers — see above. */
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
      -- The FTW verdict, read from the answers rather than from
      -- si.ftw_decision_label. Same rule savera applies in
      -- resolveFitToWorkDecision: no medication, no distraction, and ready to
      -- work safely. Anything else needs a follow-up.
      case
        when s.fit_to_work_q1 is distinct from 1
         and s.fit_to_work_q2 is distinct from 1
         and s.fit_to_work_q3 = 1
        then 'FTW aman'
        else 'FTW Perlu Tindak Lanjut'
      end                                      as ftw_decision,
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
      and si.company_id = ${env.FTW_SOURCE_COMPANY_ID}
      -- Uploaded by the person, not by the background sync. Read from the
      -- batches rather than from si.is_sync_data, which goes stale -- see the
      -- module comment.
      and exists (
        select 1
        from mobile_upload_batches b
        where b.user_id = s.user_id
          and b.upload_date = s.send_date
          and lower(b.source) in ('summary', 'detail')
      )
      -- And an FTW that was actually answered. A sleep upload with no
      -- questionnaire is not a reading; savera's page drops it, and taking it
      -- here would report someone as judged when nobody judged them.
      and (
        s.fit_to_work_submitted_at is not null
        or s.fit_to_work_q1 is not null
        or s.fit_to_work_q2 is not null
        or s.fit_to_work_q3 is not null
      )
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
