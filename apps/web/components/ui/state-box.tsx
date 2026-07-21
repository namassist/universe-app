import * as React from "react";

import { cn } from "@/lib/utils";

/* Kotak status kosong (statebox) — ikon kaca + judul + deskripsi + aksi opsional */
function StateBox({
  icon,
  iconClassName,
  title,
  body,
  children,
  className,
}: {
  icon: React.ReactNode;
  iconClassName?: string;
  title: React.ReactNode;
  body?: React.ReactNode;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("px-6 py-10 text-center", className)}>
      <div
        className={cn(
          "mx-auto mb-4 grid size-14 place-items-center rounded-icon glass-card [&_svg]:size-6",
          iconClassName
        )}
      >
        {icon}
      </div>
      <h3 className="mb-1 text-base font-semibold">{title}</h3>
      {body ? (
        <p className="mx-auto mb-5 max-w-90 text-sm leading-normal text-(--text-secondary)">
          {body}
        </p>
      ) : null}
      {children}
    </div>
  );
}

export { StateBox };
