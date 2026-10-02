"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { minuteRows } from "@/lib/ops";
import type { OpsOverview } from "@/lib/queries/ops";

/* Same axis ink and tooltip as the dashboard's charts, so the two read alike. */
const AXIS = {
  stroke: "var(--chart-grid)",
  tick: { fill: "var(--text-tertiary)", fontSize: 11 },
} as const;

function ChartTip({
  active,
  payload,
  label,
  unit,
}: {
  active?: boolean;
  payload?: { name?: string; value?: number; color?: string }[];
  label?: string | number;
  unit?: string;
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
          <b className="ml-auto font-mono">
            {p.value}
            {unit ?? ""}
          </b>
        </div>
      ))}
    </div>
  );
}

type Minutes = OpsOverview["api"]["perMinute"];

/**
 * Requests per minute, stacked by outcome. The status palette, not the
 * category one: these three are verdicts, and amber sits between green and red
 * so the two hardest for a deutan eye to tell apart never touch.
 */
export function RequestChart({ minutes }: { minutes: Minutes }) {
  const rows = minuteRows(minutes);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={rows} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="time" interval={9} {...AXIS} />
        <YAxis allowDecimals={false} {...AXIS} />
        <Tooltip
          cursor={{ fill: "var(--fill-subtle)" }}
          content={<ChartTip />}
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Bar dataKey="ok" name="Sukses" stackId="r" fill="var(--chart-good)" />
        <Bar
          dataKey="client"
          name="4xx"
          stackId="r"
          fill="var(--chart-warning)"
        />
        <Bar
          dataKey="server"
          name="5xx"
          stackId="r"
          fill="var(--chart-critical)"
        />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Average and slowest response per minute. */
export function DurationChart({ minutes }: { minutes: Minutes }) {
  const rows = minuteRows(minutes);
  return (
    <ResponsiveContainer width="100%" height={240}>
      <LineChart data={rows} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="time" interval={9} {...AXIS} />
        <YAxis allowDecimals={false} unit=" ms" {...AXIS} />
        <Tooltip content={<ChartTip unit=" ms" />} />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line
          type="monotone"
          dataKey="avgMs"
          name="Rata-rata"
          stroke="var(--chart-1)"
          strokeWidth={2}
          dot={false}
        />
        <Line
          type="monotone"
          dataKey="maxMs"
          name="Terlama"
          stroke="var(--chart-2)"
          strokeWidth={1.5}
          strokeDasharray="4 3"
          dot={false}
        />
      </LineChart>
    </ResponsiveContainer>
  );
}
