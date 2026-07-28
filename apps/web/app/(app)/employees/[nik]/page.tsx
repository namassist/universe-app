import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { serverApi } from "@/lib/api";
import { employeeKey } from "@/lib/queries/employees";
import { getQueryClient } from "@/lib/query-client";
import { EmployeeDetail } from "@/components/menus/employees-detail";

export const metadata = { title: "Detail Karyawan" };

export default async function Page({
  params,
}: {
  params: Promise<{ nik: string }>;
}) {
  const { nik } = await params;

  /**
   * Fetched on the server and handed over already resolved, so the page paints
   * its content rather than a skeleton followed by a second round trip.
   *
   * `serverApi()` rather than the browser client: a server fetch has no ambient
   * cookie jar, so without forwarding the session this prefetch would be
   * anonymous, answer 401, and hydrate an error the client then has to redo.
   *
   * A failed prefetch is deliberately not rethrown. The client query runs
   * regardless, and this screen's own not-found state — which is also what an
   * out-of-scope record produces (design D9) — is a better answer than a 500.
   */
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: employeeKey(nik),
    queryFn: async () => {
      const client = await serverApi();
      const { data, error } = await client.v1.employees({ nik }).get();
      if (error) throw error;
      return data;
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <EmployeeDetail nik={nik} />
    </HydrationBoundary>
  );
}
