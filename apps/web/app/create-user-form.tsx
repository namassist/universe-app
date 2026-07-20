"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { api } from "@/lib/api";

export function CreateUserForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setMessage(null);

    const { error } = await api.v1.users.post({
      email: String(formData.get("email")),
      name: String(formData.get("name")),
    });

    if (error) {
      // `error.value` is narrowed per status code by Eden — 409 and 422 have
      // different shapes, and TypeScript knows which one it is in each branch.
      switch (error.status) {
        case 409:
          setMessage(error.value.message);
          break;
        default:
          setMessage("Something went wrong. Try again.");
      }
      return;
    }

    // The list lives in a Server Component, so re-run it to pick up the new row.
    startTransition(() => router.refresh());
    setMessage(null);
  }

  return (
    <form
      action={onSubmit}
      className="mt-10 border-t border-neutral-200 pt-6 dark:border-neutral-800"
    >
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          name="name"
          placeholder="Name"
          required
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <input
          name="email"
          type="email"
          placeholder="you@example.com"
          required
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm dark:border-neutral-700 dark:bg-neutral-900"
        />
        <button
          type="submit"
          disabled={pending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {pending ? "Adding…" : "Add user"}
        </button>
      </div>

      {message && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{message}</p>
      )}
    </form>
  );
}
