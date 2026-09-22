/**
 * The FTW verdict source: savera's `saverawatch` database.
 *
 * savera computes a per-operator, per-day fit-to-work verdict in
 * `summary_insights_v2` on a five-minute job, and that is where this fetcher
 * used to read from. It no longer waits for it: the upload itself is read from
 * `summaries`, the category is worked out from savera's own rules
 * (`ftw-rules.ts`), and the insight row is kept only as savera's word to stand
 * beside ours. Nothing here re-runs savera's fatigue math.
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
import type { SleepRule } from "../ftw-rules";

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
 * Manual FTW uploads for the given dates, one row per person per date.
 *
 * **Read from the upload, not from savera's insight about it** (owner,
 * 2026-09-22). savera writes `summary_insights_v2` on a five-minute job, so an
 * upload stayed invisible here for up to five minutes after it landed: three
 * operators who uploaded at 05:17, 05:18 and 05:20 on 2026-09-22 had their
 * insight rows written at 05:21:00–05:21:04, after the last pass before the
 * 05:22 deadline, and read "Belum lapor" all muster. Everything this reads is
 * on `summaries` itself — sleep, the answers, the send time — and the category
 * is worked out from savera's rules (`ftw-rules.ts`), so the insight row is
 * joined only for savera's own category, which is null until its job has run.
 * Over the fifteen days before the change the two readings returned the same
 * 10,342 rows field for field; they differ only inside those five minutes.
 *
 * **The latest upload wins, entirely.** savera does not keep a second row when
 * someone re-uploads to correct an answer — it rewrites the same `summaries`
 * row, send time included — so each pass reads the correction as it stands,
 * and the upsert overwrites ours. A correction made after the deadline is
 * therefore judged late, like any late upload (owner, 2026-09-22). `DISTINCT
 * ON` keeps the newest send time should savera ever start keeping two.
 */
export const fetchFtwRows: FtwFetcher = async (dates) => {
  if (!dates.length) return [];
  const rows = await sql()`
    select distinct on (e.code, s.send_date)
      e.code                                   as nik,
      e.fullname                               as name,
      c.name                                   as company,
      d.name                                   as department,
      e.position                               as position,
      m.name                                   as mess,
      sh.name                                  as shift,
      coalesce(s.sleep, 0)::int                as sleep_minutes,
      -- savera's own category; null until its five-minute job has written the
      -- insight row. Ours comes from the rules and does not wait for it.
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
      s.send_date::text                        as date
    from summaries s
    left join summary_insights_v2 si on si.summary_id = s.id
    left join employees e
      on e.id = s.employee_id
      or (e.user_id = s.user_id and s.employee_id is null)
    left join companies c on c.id = s.company_id
    left join departments d on d.id = s.department_id
    left join messes m on m.id = e.mess_id
    left join shifts sh on sh.id = s.shift_id
    where s.send_date = any(${dates}::date[])
      and s.company_id = ${env.FTW_SOURCE_COMPANY_ID}
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
    -- Newest upload first; then, should savera ever hold two insight rows for
    -- one upload, its most recent — so a pass is deterministic either way.
    order by e.code, s.send_date, s.send_time desc nulls last,
             si.updated_at desc nulls last, si.id desc nulls last
  `;
  return rows as unknown as FtwSourceRow[];
};

/** savera's sleep rules, as `ftw-rules.ts` applies them. */
export type SleepRulesFetcher = () => Promise<SleepRule[]>;

/**
 * The sleep rules in force in savera for our company.
 *
 * Read on every pass rather than once, so an edit made in savera's master data
 * takes effect on our next pull instead of at the next deploy. Active and not
 * deleted, and only the `default` group: savera keeps test rules in the same
 * table under their own group, deleted but still present.
 *
 * Dates come back as text for the same reason every time-shaped column here
 * does — see the module comment.
 */
export const fetchSleepRules: SleepRulesFetcher = async () => {
  const rows = await sql()`
    select code,
           metric_key                  as "metricKey",
           min_minutes                 as "minMinutes",
           coalesce(min_inclusive, true)  as "minInclusive",
           max_minutes                 as "maxMinutes",
           coalesce(max_inclusive, false) as "maxInclusive",
           decision_label              as "decisionLabel",
           coalesce(priority, 0)       as priority,
           shift_id::int               as "shiftId",
           coalesce(sleep_type, 'all') as "sleepType",
           effective_from::text        as "effectiveFrom",
           effective_to::text          as "effectiveTo"
    from ftw_sleep_rules
    where company_id = ${env.FTW_SOURCE_COMPANY_ID}
      and status = true
      and deleted_at is null
      and rule_group = 'default'
  `;
  return rows as unknown as SleepRule[];
};

/** For tests and graceful shutdown. */
export async function closeFtwSource(): Promise<void> {
  if (!client) return;
  await client.end({ timeout: 3 });
  client = null;
}
