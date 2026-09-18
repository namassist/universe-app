/**
 * The four panels the operations admin used to assemble by hand.
 *
 * Every shift somebody exported the roster, the taps, the FTW list and the
 * unit register into a spreadsheet and rebuilt the same four charts for the
 * morning meeting (owner, 2026-09-18). The numbers were already in this
 * database; only the assembling was manual. So the charts move here and the
 * export stops being a job.
 *
 * All four answer questions about **one shift** — the one `deskShift` picked —
 * and the three operator panels share one categorisation, so that a bar and a
 * tile reading "DOZER" are talking about the same dozers. `unitCategory` is
 * that rule. The equipment panel is deliberately finer: it wants the tonnage
 * split that the operator panels would drown in.
 *
 * Kept out of `dashboard.ts` because it is a different kind of work. That file
 * is a dozen `count(*)`s over one roster; this is four shaped datasets with
 * their own joins, and keeping them apart is what keeps either readable.
 */

import { sql } from "drizzle-orm";
import type { ShiftKind } from "@universe/contracts";

import { db, schema } from "../db";
import { takesPartInAllocation } from "../fleet-scope";
import { FTW_PASS_CATEGORY, FTW_PASS_DECISION } from "../readiness";
import { unitCategory } from "../unit-category";

export type CategoryRatio = {
  category: string;
  ready: number;
  noFinger: number;
  noFtw: number;
};
export type CategoryCount = { category: string; operators: number };
export type EquipmentRow = {
  unitClass: string;
  qty: number;
  ready: number;
  running: number;
};
export type DashboardAnalytics = {
  operators: CategoryRatio[];
  spares: CategoryCount[];
  resting: CategoryCount[];
  equipment: EquipmentRow[];
};

/** The one roster code that schedules a shift. */
const codeOf = (shift: ShiftKind) => (shift === "night" ? "N" : "D");

/**
 * Every operator the roster puts on this shift, with their category and
 * whether they are spare.
 *
 * **One categorisation for all three operator panels.** A paired operator
 * belongs to the unit the standing plan gives them. A spare has no unit, so
 * they belong to the highest-priority unit they hold a licence for — over half
 * of them are licensed across two or three categories (58 and 14 of 131 on
 * 2026-09-18), and counting one person under each would make a treemap whose
 * tiles sum to more than the pool they are drawn from. Priority rank is the
 * tie-break rather than an arbitrary pick because it is already the order the
 * engine would crew them in: the first unit they could be given is the honest
 * answer to "what are they here to drive".
 *
 * **Spares are in the ratio chart too**, not only in their own tile. They are
 * operators this shift has, and a ratio that left out 131 of 330 people would
 * be a ratio of something nobody asked about. The tile then answers the
 * narrower question: of these, which have no unit yet.
 *
 * `TANPA KATEGORI` is for an operator who is neither paired nor licensed on
 * anything the register holds. It should be empty and is shown rather than
 * dropped, because a silently missing person is how a chart starts lying.
 */
const shiftOperators = (date: string, shift: ShiftKind) => sql`
  operators as (
    select
      e.nik,
      (ps.employee_id is null) as is_spare,
      coalesce(paired.category, licensed.category, 'TANPA KATEGORI') as category
    from ${schema.employees} e
    join ${schema.rosterDays} rd on rd.employee_id = e.id
    join ${schema.positions} p on p.id = e.position_id and p.fleet_allocation
    left join ${schema.fleetPlanSlots} ps on ps.employee_id = e.id
    left join lateral (
      select ${unitCategory} as category
      from ${schema.units} u
      join ${schema.unitTypes} on ${schema.unitTypes.id} = u.type_id
      left join ${schema.unitClasses} on ${schema.unitClasses.id} = u.class_id
      where u.id = ps.unit_id
    ) paired on true
    left join lateral (
      select ${unitCategory} as category
      from ${schema.employeeSkills} es
      join ${schema.units} u
        on u.simper_code_id = es.simper_code_id and u.active
      join ${schema.unitTypes} on ${schema.unitTypes.id} = u.type_id
      left join ${schema.unitClasses} on ${schema.unitClasses.id} = u.class_id
      left join ${schema.allocationPriorities} ap on ap.description = u.description
      where es.employee_id = e.id and ps.employee_id is null
      order by ap.rank nulls last
      limit 1
    ) licensed on true
    where e.status = 'aktif'
      and rd.date = ${date}
      and rd.code = ${codeOf(shift)}
      and exists (
        select 1 from ${schema.rosterDocuments} d
        where d.id = rd.document_id and d.status = 'aktif'
      )
  )
`;

/** The verdict half of the FTW rule, spelled as `judgeFtw` spells it. */
const ftwPassed = sql`(
  lower(btrim(f.ftw_decision)) = ${FTW_PASS_DECISION}
  and lower(btrim(f.sleep_category)) = ${FTW_PASS_CATEGORY}
)`;

/** The IN column this shift's arrival lives in — never `a ?? b`. */
const arrivalOf = (shift: ShiftKind) =>
  sql.raw(shift === "night" ? "first_in_pm_at" : "first_in_at");

export async function dashboardAnalytics(
  date: string,
  shift: ShiftKind
): Promise<DashboardAnalytics> {
  const roster = shiftOperators(date, shift);
  const arrival = arrivalOf(shift);

  /**
   * The ratio bar: three buckets, in the order they are decided.
   *
   * **NO FINGER wins over NO FTW**, and that order is the whole definition. A
   * person who is not on site has not failed a fit-to-work — they are simply
   * not here — and counting them in both would make the bar sum to more than
   * the people standing behind it. Exclusive buckets are the only reason it
   * can be read as a proportion.
   *
   * Lateness is not a bucket (owner, 2026-09-18): a filing sent after the
   * deadline fails the allocation gate, but this chart is about who can work.
   */
  const operators = await db.execute<{
    category: string;
    ready: number;
    no_finger: number;
    no_ftw: number;
  }>(sql`
    with ${roster}
    select
      o.category,
      count(*) filter (where fr.${arrival} is not null and ${ftwPassed})::int as ready,
      count(*) filter (where fr.${arrival} is null)::int as no_finger,
      count(*) filter (
        where fr.${arrival} is not null and not ${ftwPassed}
      )::int as no_ftw
    from operators o
    left join ${schema.fingerReadings} fr on fr.nik = o.nik and fr.date = ${date}
    left join ${schema.ftwReadings} f on f.nik = o.nik and f.date = ${date}
    group by o.category
    order by count(*) desc, o.category
  `);

  /** Who is on shift with no unit of their own, by what they can drive. */
  const spares = await db.execute<{ category: string; operators: number }>(sql`
    with ${roster}
    select o.category, count(*)::int as operators
    from operators o
    where o.is_spare
    group by o.category
    order by count(*) desc, o.category
  `);

  /**
   * Who savera has told to rest.
   *
   * The `Istirahat Minimal N Jam` categories only — not every failing verdict.
   * "Tidak Boleh Bekerja" is a different conversation and a different panel;
   * this one is the sleep debt the shift can still work around.
   */
  const resting = await db.execute<{ category: string; operators: number }>(sql`
    with ${roster}
    select o.category, count(*)::int as operators
    from operators o
    join ${schema.ftwReadings} f on f.nik = o.nik and f.date = ${date}
    where lower(btrim(f.sleep_category)) like 'istirahat%'
    group by o.category
    order by count(*) desc, o.category
  `);

  /**
   * The machines, by class rather than by category.
   *
   * Scoped to what allocation is about, which is why no bus and no grader
   * appears: `takesPartInAllocation` is the same rule the board is built on,
   * so a column here and a line there cannot disagree about what the fleet is.
   *
   * `ready` is the register's own answer — active, not broken down, not on
   * standby. `running` is what today's board actually seated somebody on. The
   * gap between them is the interesting number, and it is the reason both are
   * drawn rather than one.
   */
  const equipment = await db
    .select({
      unitClass: sql<string>`coalesce(${schema.unitClasses.name}, ${schema.unitTypes.name})`,
      qty: sql<number>`count(*)::int`,
      ready: sql<number>`count(*) filter (
        where not ${schema.units.breakdown} and not ${schema.units.standby})::int`,
      running: sql<number>`count(*) filter (where exists (
        select 1 from ${schema.fleetActualSlots} s
        join ${schema.fleetActualDocuments} fd on fd.id = s.document_id
        where s.unit_id = ${schema.units.id}
          and fd.date = ${date}
          and fd.shift = ${shift}
          and s.employee_id is not null))::int`,
    })
    .from(schema.units)
    .innerJoin(
      schema.unitTypes,
      sql`${schema.unitTypes.id} = ${schema.units.typeId}`
    )
    .leftJoin(
      schema.unitClasses,
      sql`${schema.unitClasses.id} = ${schema.units.classId}`
    )
    .where(
      sql`${schema.units.active} and ${takesPartInAllocation(
        schema.units.id,
        schema.units.fleetSupport
      )}`
    )
    .groupBy(
      sql`coalesce(${schema.unitClasses.name}, ${schema.unitTypes.name})`
    )
    .orderBy(sql`count(*) desc`);

  return {
    operators: operators.map((r) => ({
      category: r.category,
      ready: r.ready,
      noFinger: r.no_finger,
      noFtw: r.no_ftw,
    })),
    spares: spares.map((r) => ({
      category: r.category,
      operators: r.operators,
    })),
    resting: resting.map((r) => ({
      category: r.category,
      operators: r.operators,
    })),
    equipment,
  };
}
