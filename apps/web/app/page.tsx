import { dehydrate, HydrationBoundary } from "@tanstack/react-query";

import { usersQueryOptions } from "@/lib/queries/users";
import { getQueryClient } from "@/lib/query-client";

import { CreateUserForm } from "./create-user-form";
import { UsersList } from "./users-list";

/**
 * Next 16 does not cache `fetch` per request, but it still prerenders this
 * route at build time — which would bake in whatever the API returned during
 * `next build`. The prefetch below must run per request, so opt out of static.
 */
export const dynamic = "force-dynamic";

/**
 * Server Component. It runs the users query on the server (the API does not
 * need to be reachable from the browser for the first paint), then dehydrates
 * that cache into the client so <UsersList /> renders with data immediately.
 */
export default async function Home() {
  const queryClient = getQueryClient();
  await queryClient.prefetchQuery(usersQueryOptions);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Served by Elysia on :3001, rendered by Next.js on :3000.
      </p>

      <HydrationBoundary state={dehydrate(queryClient)}>
        <UsersList />
        <CreateUserForm />
      </HydrationBoundary>
    </main>
  );
}
