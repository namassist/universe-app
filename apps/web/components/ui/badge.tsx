import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-chip border px-2.5 py-[3px] text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      variant: {
        success:
          "border-(--badge-success-border) bg-(--badge-success-fill) text-(--badge-success-text)",
        warning:
          "border-(--badge-warning-border) bg-(--badge-warning-fill) text-(--badge-warning-text)",
        danger:
          "border-(--badge-danger-border) bg-(--badge-danger-fill) text-(--badge-danger-text)",
        info: "border-[rgba(0,212,255,.4)] bg-[rgba(0,212,255,.12)] text-primary-bright",
        neutral:
          "border-(--badge-neutral-border) bg-(--badge-neutral-fill) text-(--badge-neutral-text)",
        /** Organisational tags (department badges) — never a status. */
        accent:
          "border-(--badge-accent-border) bg-(--badge-accent-fill) text-(--badge-accent-text)",
      },
    },
    defaultVariants: {
      variant: "neutral",
    },
  }
);

export type BadgeVariant = NonNullable<
  VariantProps<typeof badgeVariants>["variant"]
>;

export type BadgeProps = React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { dot?: boolean };

function Badge({ className, variant, dot, children, ...props }: BadgeProps) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant }), className)}
      {...props}
    >
      {dot ? (
        <span className="size-1.5 flex-none rounded-full bg-current" />
      ) : null}
      {children}
    </span>
  );
}

export { Badge, badgeVariants };
