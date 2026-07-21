import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex flex-none cursor-pointer items-center justify-center gap-2 rounded-control border border-transparent text-sm font-semibold whitespace-nowrap text-(--text-primary) transition-[box-shadow,background-color,border-color,transform] duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:cursor-not-allowed [&_svg]:size-[15px] [&_svg]:flex-none",
  {
    variants: {
      variant: {
        primary:
          "bg-(image:--gradient-cta) font-bold text-on-cta shadow-(--glow-cta) hover:-translate-y-px hover:bg-(image:--gradient-cta-hover) hover:shadow-[0_10px_28px_rgba(0,212,255,.5)] disabled:translate-y-0 disabled:bg-(--fill-hover-strong) disabled:bg-none disabled:text-(--text-disabled) disabled:shadow-none",
        secondary:
          "border-(--border-btn-secondary) bg-(--fill-hover) font-medium backdrop-blur-xl hover:border-[rgba(0,212,255,.45)] hover:bg-(--divider)",
        destructive:
          "border-(--badge-danger-border) bg-(--badge-danger-fill) text-danger-text hover:border-[rgba(252,60,59,.6)] hover:bg-[rgba(252,60,59,.28)] disabled:border-[rgba(252,60,59,.15)] disabled:bg-[rgba(252,60,59,.06)] disabled:text-[rgba(255,122,121,.4)]",
        ghost:
          "bg-transparent font-medium text-(--text-secondary) hover:bg-(--fill-hover) hover:text-(--text-primary)",
      },
      size: {
        default: "h-10 px-4",
        sm: "h-9 px-4 text-[13px]",
        icon: "size-9 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "default",
    },
  }
);

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants>;

function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button
      data-slot="button"
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}

/* Tombol ikon 36px (btn-icon kit kontrol) — danger mengubah hover ke merah */
function IconButton({
  className,
  danger,
  ...props
}: React.ComponentProps<"button"> & { danger?: boolean }) {
  return (
    <button
      data-slot="icon-button"
      className={cn(
        "inline-flex size-9 flex-none cursor-pointer items-center justify-center rounded-control border border-(--glass-1-border) bg-(--fill-subtle) transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary [&_svg]:size-4 [&_svg]:text-(--text-secondary)",
        danger
          ? "hover:border-(--badge-danger-border) hover:bg-(--badge-danger-fill) [&:hover_svg]:text-danger-text"
          : "hover:border-[rgba(0,212,255,.4)] hover:bg-[rgba(0,212,255,.14)] [&:hover_svg]:text-primary-bright",
        className
      )}
      {...props}
    />
  );
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "size-[15px] flex-none animate-rot rounded-full border-2 border-(--border-btn-secondary) border-t-current",
        className
      )}
    />
  );
}

export { Button, IconButton, Spinner, buttonVariants };
