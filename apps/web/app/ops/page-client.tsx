"use client";

import { useQuery } from "@tanstack/react-query";
import { CircleAlert } from "lucide-react";

import { isStatus } from "@/lib/api";
import { opsOverviewQueryOptions } from "@/lib/queries/ops";
import { Spinner } from "@/components/ui/button";
import { StateBox } from "@/components/ui/state-box";

import { OpsDashboard } from "./_components/ops-dashboard";
import { OpsLogin } from "./_components/ops-login";

/**
 * Operations Center — one page, two states: the password form, or the
 * dashboard. Which one is the API's answer, not a guess: a 401 from the
 * overview is "no ops session", and 404 is "this deployment has no Operations
 * Center" (no `OPS_PASSWORD_HASH`), which no password can change.
 */
export default function PageClient() {
  const overview = useQuery(opsOverviewQueryOptions());

  if (overview.isPending)
    return (
      <main className="grid min-h-dvh place-items-center">
        <Spinner className="size-6" />
      </main>
    );

  if (overview.isError && isStatus(overview.error, 401))
    return <OpsLogin onOpened={() => overview.refetch()} />;

  /* A failed poll keeps the last good picture on screen: this page is left
     open on a second monitor, and one blip must not blank it. */
  if (overview.isError && !overview.data)
    return (
      <main className="grid min-h-dvh place-items-center px-4">
        <StateBox
          icon={<CircleAlert className="text-(--color-danger-text)" />}
          title={
            isStatus(overview.error, 404)
              ? "Operations Center tidak aktif"
              : "Gagal memuat Operations Center"
          }
          body={
            isStatus(overview.error, 404)
              ? "Deployment ini belum mengatur OPS_PASSWORD_HASH."
              : "Periksa koneksi ke API, lalu muat ulang halaman."
          }
        />
      </main>
    );

  return (
    <OpsDashboard
      data={overview.data}
      refreshing={overview.isFetching}
      stale={overview.isError}
      updatedAt={overview.dataUpdatedAt}
      onRefresh={() => overview.refetch()}
    />
  );
}
