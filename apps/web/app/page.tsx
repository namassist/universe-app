import Link from "next/link";

import { ROLE_LABELS, ROLES } from "@/lib/access";

export const metadata = { title: "Pilih Role" };

/**
 * Minimal index. Per the static-only design there is no auth or role switcher —
 * open a role's URL directly. These links are a convenience for that.
 */
export default function Home() {
  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight text-(--text-primary)">
        UNIVERSE — Static Preview
      </h1>
      <p className="mt-1 text-sm text-(--text-secondary)">
        Pilih role untuk masuk ke shell-nya. URL langsung:{" "}
        <code>/{"{role}"}/dashboard</code>.
      </p>

      <ul className="mt-8 grid gap-3 sm:grid-cols-2">
        {ROLES.map((role) => (
          <li key={role}>
            <Link
              href={`/${role}/dashboard`}
              className="flex items-center justify-between rounded-card px-5 py-4 text-sm font-medium text-(--text-primary) glass-card transition hover:bg-(--fill-hover)"
            >
              {ROLE_LABELS[role]}
              <span className="text-(--text-tertiary)">/{role}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
