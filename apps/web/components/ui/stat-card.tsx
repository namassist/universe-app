import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";

/* Kartu statistik G2 (stat) — opsional tautan dengan panah pojok */
function StatCard({
  href,
  icon,
  iconStyle,
  value,
  label,
  detail,
  className,
}: {
  href?: string;
  icon: React.ReactNode;
  iconStyle: { background: string; borderColor: string; color: string };
  value: React.ReactNode;
  label: React.ReactNode;
  detail?: React.ReactNode;
  className?: string;
}) {
  const body = (
    <>
      {href ? (
        <span className="absolute top-4 right-4 grid size-6.5 place-items-center rounded-lg border border-(--glass-1-border) bg-(--fill-subtle) group-hover:border-[rgba(0,212,255,.4)] group-hover:bg-[rgba(0,212,255,.16)]">
          <ArrowUpRight className="size-[13px] text-(--text-tertiary) group-hover:text-primary-bright" />
        </span>
      ) : null}
      <div
        className="mb-3 grid size-11 place-items-center rounded-icon border [&_svg]:size-5"
        style={{
          background: iconStyle.background,
          borderColor: iconStyle.borderColor,
          color: iconStyle.color,
        }}
      >
        {icon}
      </div>
      <div className="text-[32px] leading-tight font-bold tabular-nums">
        {value}
      </div>
      <div className="mt-0.5 text-sm text-(--text-secondary)">{label}</div>
      {detail ? (
        <div className="mt-2 text-xs text-(--text-tertiary) [&_b]:font-semibold [&_b]:text-(--text-primary)">
          {detail}
        </div>
      ) : null}
    </>
  );

  const baseClass = cn(
    "relative block rounded-card p-5 glass-card transition-[border-color,box-shadow,transform] duration-150",
    className
  );

  if (href) {
    return (
      <Link
        href={href}
        className={cn(
          baseClass,
          "group text-inherit no-underline hover:-translate-y-0.5 hover:border-[rgba(0,212,255,.45)] hover:text-inherit hover:no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        )}
      >
        {body}
      </Link>
    );
  }
  return <div className={baseClass}>{body}</div>;
}

export { StatCard };
