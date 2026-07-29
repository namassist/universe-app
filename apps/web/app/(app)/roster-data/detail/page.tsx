import { Suspense } from "react";
import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { serverApi } from "@/lib/api";
import { rosterDaysKey, rosterDocumentKey } from "@/lib/queries/roster";
import { getQueryClient } from "@/lib/query-client";
import { RosterDetail } from "@/components/menus/roster-detail";

export const metadata = { title: "Detail Roster" };

/**
 * The page the client mounts with. It has to match `RosterDetail`'s initial
 * state exactly — a prefetch under a different page size lands on a key nothing
 * reads, which looks like the prefetch simply not working.
 */
const FIRST_PAGE = { page: 1, pageSize: 25 };

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ p?: string }>;
}) {
  const { p: id } = await searchParams;
  const queryClient = getQueryClient();

  if (id) {
    const client = await serverApi();
    // Both in flight together: the header and the grid are one screen, and
    // serialising them would paint the document a round trip before its rows.
    // Neither rejection is rethrown — the client queries run regardless, and
    // this screen's own error state beats a 500.
    await Promise.all([
      queryClient.prefetchQuery({
        queryKey: rosterDocumentKey(id),
        queryFn: async () => {
          const { data, error } = await client.v1.roster({ id }).get();
          if (error) throw error;
          return data;
        },
      }),
      queryClient.prefetchQuery({
        queryKey: rosterDaysKey(id, FIRST_PAGE),
        queryFn: async () => {
          const { data, error } = await client.v1
            .roster({ id })
            .days.get({ query: FIRST_PAGE });
          if (error) throw error;
          return data;
        },
      }),
    ]);
  }

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <Suspense>
        <RosterDetail />
      </Suspense>
    </HydrationBoundary>
  );
}
