/** One count in a PLAN confirmation dialog — Reset's and Generate's. */
export function PlanStat({ n, label }: { n: number; label: string }) {
  return (
    <div className="flex-1 rounded-card border border-(--glass-2-border) px-3 py-2 text-center">
      <div className="text-lg font-bold tabular-nums">{n}</div>
      <div className="text-xs text-(--text-secondary)">{label}</div>
    </div>
  );
}
