"use client";

import * as React from "react";
import { ChartColumnBig } from "lucide-react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  Treemap,
  XAxis,
  YAxis,
} from "recharts";

import { useI18n, type Dict } from "@/lib/i18n";
import type { Dashboard } from "@/lib/queries/dashboard";
import { Panel, ToolbarTitle } from "@/components/ui/panel";
import { StateBox } from "@/components/ui/state-box";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type Analytics = NonNullable<Dashboard["analytics"]>;

/**
 * The order a category takes its colour slot from.
 *
 * Fixed, and fixed to the *entity* rather than to its size — which is the
 * whole point. These charts re-sort themselves every minute as the shift
 * moves, and a palette assigned by rank would repaint DOZER a different
 * colour the moment one more dozer operator tapped in. Colour is identity
 * here, so it has to be the one thing that does not move.
 *
 * Names are the unit register's own (`unit_types`, and `unit_classes` for the
 * excavators). The morning report writes these as OHT, DT and DIGGER; the
 * screen deliberately does not, because every other menu in this application
 * spells them the way the register does and one screen inventing a second
 * vocabulary is how two people end up counting different things.
 *
 * These eight are the eight the register actually produces for operators on
 * either shift — checked, not assumed: the first draft of this list carried
 * `WHEELDIGGER` (one machine, in no formation, crewed by nobody) and left out
 * `MANHAUL TRUCK`, which would have quietly folded five real operators into
 * "LAINNYA". A wheel excavator or a grader still can appear the day one is
 * put in a formation, and it lands in the fold rather than stealing a hue.
 */
const CATEGORY_ORDER = [
  "BIGDIGGER",
  "MEDIUMDIGGER",
  "SMALLDIGGER",
  "REAR DUMP TRUCK",
  "DUMP TRUCK",
  "DOZER",
  "WATER TRUCK",
  "MANHAUL TRUCK",
] as const;

/** Beyond the eighth slot a hue would have to be cycled, so it is not. */
const OTHER = "LAINNYA";

const slotOf = (category: string) => CATEGORY_ORDER.indexOf(category as never);
const colourOf = (category: string) => {
  const slot = slotOf(category);
  return slot < 0 ? "var(--text-tertiary)" : `var(--chart-${slot + 1})`;
};

/**
 * Anything outside the eight named categories, gathered into one tile.
 *
 * A ninth hue is never generated (it would collide with one of the eight under
 * colour-vision deficiency, which is exactly what the fixed order prevents).
 * Graders, wheel excavators and the unlicensed fall here, and they are shown
 * rather than dropped — a category that vanishes is how a chart starts lying.
 */
function foldTail<T extends { category: string }>(
  rows: T[],
  merge: (a: T, b: T) => T
): T[] {
  const kept = new Map<string, T>();
  for (const row of rows) {
    const key = slotOf(row.category) < 0 ? OTHER : row.category;
    const seen = kept.get(key);
    kept.set(
      key,
      seen ? merge(seen, { ...row, category: key }) : { ...row, category: key }
    );
  }
  return [...kept.values()];
}

/* ---- chrome shared by all four panels ---- */

const AXIS = {
  stroke: "var(--chart-grid)",
  tick: { fill: "var(--text-tertiary)", fontSize: 11 },
} as const;

/**
 * The tooltip, in the app's own ink rather than recharts' white box.
 *
 * Values wear text tokens and the series colour rides on a swatch beside them
 * — coloured text on a glass panel is the one place this palette's light-mode
 * steps drop below the contrast floor.
 */
function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-control border border-(--glass-1-border) bg-(--color-bg) px-3 py-2 text-xs shadow-lg">
      <div className="mb-1 font-semibold">{label}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span
            className="size-2 shrink-0 rounded-[2px]"
            style={{ background: p.color }}
          />
          <span className="text-(--text-secondary)">{p.name}</span>
          <b className="ml-auto font-mono">{p.value}</b>
        </div>
      ))}
    </div>
  );
}

function ChartPanel({
  title,
  empty,
  children,
}: {
  title: string;
  empty: boolean;
  children: React.ReactNode;
}) {
  const { t } = useI18n();
  return (
    <Panel className="flex min-w-0 flex-col">
      <ToolbarTitle className="mb-4 text-base">{title}</ToolbarTitle>
      {empty ? (
        <StateBox
          icon={<ChartColumnBig className="text-(--text-tertiary)" />}
          title={t.noResTitle}
          body={t.chartNoData}
        />
      ) : (
        children
      )}
    </Panel>
  );
}

/* ---- 1. the operator ratio ---- */

/**
 * What stops each category of operator from working, as a proportion.
 *
 * A 100% stacked bar rather than counts side by side, because the categories
 * differ by two orders of magnitude — 147 truck operators against 3 on medium
 * excavators — and on a count axis the small ones would be invisible slivers
 * of the exact thing somebody needs to see. The counts are printed inside the
 * segments and repeated in the table beneath, so the proportion never has to
 * be read back as a number.
 *
 * **Segment order is load-bearing.** Ready, then no-FTW, then no-finger: the
 * status green and the status red sit ΔE 4.1 apart under deuteranopia, so
 * amber is always between them and they never share an edge. Every segment
 * carries its own count, and the table below is the relief the light-mode
 * contrast warning obliges.
 */
function OperatorRatio({
  rows,
  title,
  t,
}: {
  rows: Analytics["operators"];
  title: string;
  t: Dict;
}) {
  const data = React.useMemo(
    () =>
      foldTail(rows, (a, b) => ({
        category: a.category,
        ready: a.ready + b.ready,
        noFinger: a.noFinger + b.noFinger,
        noFtw: a.noFtw + b.noFtw,
      }))
        .map((r) => {
          const total = r.ready + r.noFtw + r.noFinger || 1;
          return {
            ...r,
            total,
            readyPct: (r.ready / total) * 100,
            noFtwPct: (r.noFtw / total) * 100,
            noFingerPct: (r.noFinger / total) * 100,
          };
        })
        .sort((a, b) => b.total - a.total),
    [rows]
  );

  const series = [
    {
      key: "readyPct",
      count: "ready",
      name: t.chartReady,
      fill: "var(--chart-good)",
    },
    {
      key: "noFtwPct",
      count: "noFtw",
      name: t.chartNoFtw,
      fill: "var(--chart-warning)",
    },
    {
      key: "noFingerPct",
      count: "noFinger",
      name: t.chartNoFinger,
      fill: "var(--chart-critical)",
    },
  ] as const;

  return (
    <ChartPanel title={title} empty={!data.length}>
      <ResponsiveContainer width="100%" height={40 + data.length * 34}>
        <BarChart
          layout="vertical"
          data={data}
          margin={{ top: 4, right: 8, bottom: 4, left: 8 }}
          barCategoryGap="22%"
        >
          <CartesianGrid horizontal={false} stroke="var(--chart-grid)" />
          <XAxis
            type="number"
            domain={[0, 100]}
            ticks={[0, 25, 50, 75, 100]}
            tickFormatter={(v: number) => `${v}%`}
            {...AXIS}
          />
          <YAxis
            type="category"
            dataKey="category"
            width={112}
            tickLine={false}
            {...AXIS}
          />
          <Tooltip
            content={<ChartTip />}
            formatter={
              ((
                value: number,
                name: string,
                item: { payload: Record<string, number> }
              ) => [
                item.payload[
                  series.find((s) => s.name === name)?.count ?? ""
                ] ?? value,
                name,
              ]) as never
            }
            cursor={{ fill: "var(--fill-subtle)" }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            iconType="square"
            iconSize={9}
            wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
          />
          {series.map((s, i) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              stackId="ratio"
              fill={s.fill}
              /* A hairline of the panel between fills, so two segments of
                 similar lightness never bleed into one another. */
              stroke="var(--color-bg)"
              strokeWidth={1}
              radius={i === series.length - 1 ? [0, 4, 4, 0] : undefined}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>

      {/* The table the reference report carried under its chart, kept for the
          same reason the skill asks for one: a proportion is not a number, and
          somebody always wants the number. */}
      <div className="mt-4 overflow-x-auto">
        <Table>
          <TableHeader>
            <tr>
              <TableHead>{t.chartCategory}</TableHead>
              {series.map((s) => (
                <TableHead key={s.key} className="text-right">
                  {s.name}
                </TableHead>
              ))}
              <TableHead className="text-right">{t.chartTotal}</TableHead>
            </tr>
          </TableHeader>
          <TableBody>
            {data.map((r) => (
              <TableRow key={r.category}>
                <TableCell>{r.category}</TableCell>
                <TableCell className="text-right font-mono">
                  {r.ready}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {r.noFtw}
                </TableCell>
                <TableCell className="text-right font-mono">
                  {r.noFinger}
                </TableCell>
                <TableCell className="text-right font-mono font-semibold">
                  {r.total}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </ChartPanel>
  );
}

/* ---- 2 & 4. the two treemaps ---- */

type Tile = { category: string; operators: number; fill: string };

/**
 * One tile per category, area by headcount, every tile named on its face.
 *
 * The label is not decoration: four of the eight light-mode steps sit below
 * 3:1 against this panel, and a named tile is the relief that buys. It also
 * means colour is carrying nothing on its own here — pleasant, consistent
 * with the bars beside it, and not load-bearing.
 */
function TreemapTile(props: {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  category?: string;
  operators?: number;
  fill?: string;
  suffix: string;
}) {
  const {
    x = 0,
    y = 0,
    width = 0,
    height = 0,
    category,
    operators,
    fill,
  } = props;
  const room = width > 74 && height > 30;
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        fill={fill}
        stroke="var(--color-bg)"
        strokeWidth={2}
        rx={4}
      />
      {room ? (
        <>
          <text
            x={x + 8}
            y={y + height - 20}
            fill="#ffffff"
            fontSize={11}
            fontWeight={600}
          >
            {category}
          </text>
          <text x={x + 8} y={y + height - 7} fill="#ffffff" fontSize={11}>
            {operators} {props.suffix}
          </text>
        </>
      ) : null}
    </g>
  );
}

function CategoryTreemap({
  title,
  rows,
  suffix,
  t,
}: {
  title: string;
  rows: Analytics["spares"];
  suffix: string;
  t: Dict;
}) {
  const data = React.useMemo<Tile[]>(
    () =>
      foldTail(rows, (a, b) => ({
        category: a.category,
        operators: a.operators + b.operators,
      }))
        .map((r) => ({ ...r, fill: colourOf(r.category) }))
        .sort((a, b) => b.operators - a.operators),
    [rows]
  );

  return (
    <ChartPanel title={title} empty={!data.length}>
      {/* The legend is present whatever the tiles say, because a tile too
          small to hold its own name is exactly the one a reader has to look
          up. */}
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {data.map((tile) => (
          <span key={tile.category} className="flex items-center gap-1.5">
            <span
              className="size-2.5 rounded-[2px]"
              style={{ background: tile.fill }}
            />
            <span className="text-(--text-secondary)">{tile.category}</span>
            <b className="font-mono">{tile.operators}</b>
          </span>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <Treemap
          data={data}
          dataKey="operators"
          nameKey="category"
          isAnimationActive={false}
          content={<TreemapTile suffix={suffix} />}
        >
          <Tooltip
            content={<ChartTip />}
            formatter={((value: number) => [value, t.chartOperators]) as never}
          />
        </Treemap>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

/* ---- 3. the equipment report ---- */

/**
 * Three counts per unit class on one axis.
 *
 * The report this replaces drew them against a percentage axis and then
 * printed absolute counts on the bars — two scales in one frame, which is the
 * one chart mistake worth going out of the way to avoid. Here the axis counts
 * machines and so do the bars, and the gap between "ready" and "running" is
 * readable as what it is: units nobody was put on.
 */
function EquipmentReport({
  rows,
  title,
  t,
}: {
  rows: Analytics["equipment"];
  title: string;
  t: Dict;
}) {
  const data = React.useMemo(
    () => [...rows].sort((a, b) => b.qty - a.qty),
    [rows]
  );
  const series = [
    { key: "qty", name: t.chartQty, fill: "var(--chart-1)" },
    { key: "ready", name: t.chartEqpReady, fill: "var(--chart-2)" },
    { key: "running", name: t.chartRunning, fill: "var(--chart-3)" },
  ] as const;

  return (
    <ChartPanel title={title} empty={!data.length}>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart
          data={data}
          margin={{ top: 4, right: 8, bottom: 52, left: 0 }}
          barGap={2}
        >
          <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
          <XAxis
            dataKey="unitClass"
            interval={0}
            angle={-38}
            textAnchor="end"
            height={60}
            tickLine={false}
            {...AXIS}
          />
          <YAxis allowDecimals={false} {...AXIS} />
          <Tooltip
            content={<ChartTip />}
            cursor={{ fill: "var(--fill-subtle)" }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            iconType="square"
            iconSize={9}
            wrapperStyle={{ fontSize: 12, paddingBottom: 8 }}
          />
          {series.map((s) => (
            <Bar
              key={s.key}
              dataKey={s.key}
              name={s.name}
              fill={s.fill}
              radius={[4, 4, 0, 0]}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </ChartPanel>
  );
}

/* ---- the grid ---- */

/**
 * The four panels the operations admin used to rebuild by hand every shift.
 *
 * Stacked by how much width each one needs rather than in a plain grid (owner,
 * 2026-09-18). The ratio chart carries a bar and a table row per category and
 * the equipment report a group of three columns per unit class — both run out
 * of room in half a screen, and a rotated axis label is the first thing to go.
 * The two treemaps are a handful of tiles each and sit side by side beneath
 * them, dropping to one column when the viewport can no longer hold two.
 */
export function DashboardCharts({
  analytics,
  shiftLabel,
}: {
  analytics: Analytics;
  shiftLabel: string;
}) {
  const { t } = useI18n();
  const title = (base: string) => `${base} — ${shiftLabel}`;
  return (
    <div className="flex flex-col gap-6">
      <OperatorRatio
        rows={analytics.operators}
        title={title(t.chartRatioTitle)}
        t={t}
      />
      <EquipmentReport
        rows={analytics.equipment}
        title={title(t.chartEquipmentTitle)}
        t={t}
      />
      <div className="grid grid-cols-2 gap-6 max-xl:grid-cols-1">
        <CategoryTreemap
          title={title(t.chartSpareTitle)}
          rows={analytics.spares}
          suffix={t.chartOperators}
          t={t}
        />
        <CategoryTreemap
          title={title(t.chartRestTitle)}
          rows={analytics.resting}
          suffix={t.chartOperators}
          t={t}
        />
      </div>
    </div>
  );
}
