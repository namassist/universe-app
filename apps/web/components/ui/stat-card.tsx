import * as React from "react";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";

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

/**
 * The card's shape while its number is on the way.
 *
 * Built from the same chrome and the same line heights as the real card — the
 * 44px icon well, the 32px figure, the label, the detail line — so that when
 * the data lands nothing on the page moves. A skeleton that is a few pixels
 * off is worse than none: the whole grid jumps the moment it is replaced, and
 * the eye reads the jump as something having changed.
 */
function StatCardSkeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn("relative block rounded-card p-5 glass-card", className)}
    >
      <Skeleton className="mb-3 size-11 rounded-icon" />
      <Skeleton className="h-10 w-20" />
      <Skeleton className="mt-0.5 h-5 w-32" />
      <Skeleton className="mt-2 h-4 w-24" />
    </div>
  );
}

export { StatCard, StatCardSkeleton };
