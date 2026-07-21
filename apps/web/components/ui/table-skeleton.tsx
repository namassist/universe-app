import * as React from "react";

import { Skeleton } from "@/components/ui/skeleton";

/* Placeholder tabel server-paginated saat fetch pertama — dipakai halaman
   ber-pagination server (Users, Employees) supaya StateBox "tidak ada
   hasil" tidak berkedip sebelum data datang. */
export function TableSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="flex flex-col gap-2 p-4" aria-busy="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}
