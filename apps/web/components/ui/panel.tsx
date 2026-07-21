import * as React from "react";

import { cn } from "@/lib/utils";

/* Panel kaca G1 — sidebar, TableCard, section */
function Panel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel"
      className={cn("rounded-panel p-6 glass-panel", className)}
      {...props}
    />
  );
}

/* Toolbar panel: judul kiri + grup kontrol kanan */
function Toolbar({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar"
      className={cn(
        "mb-5 flex flex-wrap items-center justify-between gap-3",
        className
      )}
      {...props}
    />
  );
}

function ToolbarTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="toolbar-title"
      className={cn("mr-auto text-xl font-semibold", className)}
      {...props}
    />
  );
}

function ToolbarGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="toolbar-group"
      className={cn("flex flex-wrap items-center justify-end gap-2", className)}
      {...props}
    />
  );
}

/* Footer panel: ringkasan + aksi/pagination */
function PanelFoot({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="panel-foot"
      className={cn(
        "mt-5 flex flex-wrap items-center justify-between gap-3",
        className
      )}
      {...props}
    />
  );
}

function FootSum({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="foot-sum"
      className={cn(
        "text-sm text-(--text-secondary) [&_b]:font-semibold [&_b]:text-(--text-primary)",
        className
      )}
      {...props}
    />
  );
}

/* Judul section (panel .sect h2) dengan ikon cyan */
function SectionTitle({ className, ...props }: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="section-title"
      className={cn(
        "mb-4 flex items-center gap-2 text-base font-semibold [&_svg]:size-4 [&_svg]:text-primary-bright",
        className
      )}
      {...props}
    />
  );
}

/* Judul halaman + subjudul */
function PageTitle({
  className,
  title,
  sub,
  children,
  ...props
}: React.ComponentProps<"div"> & {
  title: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div
      data-slot="page-title"
      className={cn(
        "flex flex-wrap items-end justify-between gap-4",
        className
      )}
      {...props}
    >
      <div>
        <h1 className="text-2xl font-bold">{title}</h1>
        {sub ? (
          <p className="mt-0.5 text-sm text-(--text-secondary)">{sub}</p>
        ) : null}
      </div>
      {children}
    </div>
  );
}

/* Indikator kesegaran data (fresh + fdot) */
function Fresh({ className, children, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="fresh"
      className={cn(
        "flex items-center gap-2 text-xs text-(--text-tertiary)",
        className
      )}
      {...props}
    >
      <span className="size-[7px] rounded-full bg-success shadow-[0_0_6px_rgba(23,206,100,.8)]" />
      {children}
    </div>
  );
}

/* Catatan keterkaitan (dnote) */
function DNote({
  className,
  title,
  children,
  ...props
}: React.ComponentProps<"div"> & { title: React.ReactNode }) {
  return (
    <div
      data-slot="dnote"
      className={cn(
        "rounded-card border border-(--divider) bg-(--fill-subtle) p-4",
        className
      )}
      {...props}
    >
      <b className="mb-1 block text-[13px] font-semibold">{title}</b>
      <p className="text-xs leading-relaxed text-(--text-secondary)">
        {children}
      </p>
    </div>
  );
}

export {
  Panel,
  Toolbar,
  ToolbarTitle,
  ToolbarGroup,
  PanelFoot,
  FootSum,
  SectionTitle,
  PageTitle,
  Fresh,
  DNote,
};
