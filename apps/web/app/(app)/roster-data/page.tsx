import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { serverApi } from "@/lib/api";
import { rosterDocumentsKey } from "@/lib/queries/roster";
import { getQueryClient } from "@/lib/query-client";
import { MenuPage } from "@/components/menus/registry";

export const metadata = { title: "Data Roster" };

/**
 * Fetched on the server so the list paints its rows rather than a skeleton
 * followed by a second round trip.
 *
 * `serverApi()` rather than the browser client: a server fetch has no ambient
 * cookie jar, so without forwarding the session this prefetch would be
 * anonymous, answer 401, and hydrate an error the client then has to redo. A
 * failed prefetch is deliberately not rethrown — the client query runs anyway,
 * and this screen's own error state is a better answer than a 500.
 *
 * The unfiltered key, because that is what the screen mounts with. Any filter
 * the operator then applies is a different key and a fresh request, which is
 * the whole point of filtering server-side.
 */
export default async function Page() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery({
    queryKey: rosterDocumentsKey({}),
    queryFn: async () => {
      const client = await serverApi();
      const { data, error } = await client.v1.roster.get({ query: {} });
      if (error) throw error;
      return data;
    },
  });

  return (
    <HydrationBoundary state={dehydrate(queryClient)}>
      <MenuPage slug="roster-data" />
    </HydrationBoundary>
  );
}
