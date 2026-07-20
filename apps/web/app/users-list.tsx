"use client";

import { useQuery } from "@tanstack/react-query";

import { usersQueryOptions } from "@/lib/queries/users";

/**
 * Client Component. It reads the same query the server prefetched, so the first
 * render already has data (no loading flash) — after that TanStack Query owns
 * it: refetch on focus, and refetch when a mutation invalidates ["users"].
 */
export function UsersList() {
  const {
    data: users,
    isPending,
    isError,
    error,
  } = useQuery(usersQueryOptions);

  if (isError) {
    return (
      <p className="mt-8 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
        Could not reach the API ({error.message}). Is <code>bun run dev</code>{" "}
        running?
      </p>
    );
  }

  // On the prefetched path this is already false on first render. It only shows
  // when there is no dehydrated data (a client-side navigation, say), so the
  // empty state below never flashes while a fetch is still in flight.
  if (isPending) {
    return <p className="mt-8 text-sm text-neutral-500">Loading users…</p>;
  }

  if (!users.length) {
    return (
      <p className="mt-8 text-sm text-neutral-500">
        No users yet. Add one below.
      </p>
    );
  }

  return (
    <ul className="mt-8 divide-y divide-neutral-200 dark:divide-neutral-800">
      {users.map((user) => (
        <li key={user.id} className="flex items-center justify-between py-3">
          <div>
            <p className="text-sm font-medium">{user.name}</p>
            <p className="text-sm text-neutral-500">{user.email}</p>
          </div>
          <span className="rounded-full bg-neutral-100 px-2.5 py-0.5 text-xs text-neutral-600 dark:bg-neutral-800 dark:text-neutral-400">
            {user.role}
          </span>
        </li>
      ))}
    </ul>
  );
}
