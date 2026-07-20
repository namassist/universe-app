import { api } from "@/lib/api";

import { CreateUserForm } from "./create-user-form";

/**
 * Next 16 does not cache `fetch` per request, but it still prerenders this
 * route at build time — which would bake in whatever the API returned during
 * `next build` (or the error state, if the API was not running). A user list
 * has to be read per request.
 */
export const dynamic = "force-dynamic";

/**
 * Server Component. The Eden call runs on the server, so the API does not need
 * to be reachable from the browser for this page to render.
 */
export default async function Home() {
  const { data: users, error } = await api.v1.users.get();

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Users</h1>
      <p className="mt-1 text-sm text-neutral-500">
        Served by Elysia on :3001, rendered by Next.js on :3000.
      </p>

      {error ? (
        <p className="mt-8 rounded-md border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          Could not reach the API ({error.status}). Is <code>bun run dev</code>{" "}
          running?
        </p>
      ) : (
        <ul className="mt-8 divide-y divide-neutral-200 dark:divide-neutral-800">
          {users.map((user) => (
            <li
              key={user.id}
              className="flex items-center justify-between py-3"
            >
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
      )}

      <CreateUserForm />
    </main>
  );
}
