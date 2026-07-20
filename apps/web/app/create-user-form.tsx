"use client";

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api";
import { usersQueryOptions } from "@/lib/queries/users";

type CreateInput = { name: string; email: string };
// Eden types the response per status code. Pull the error union straight off
// the call's return type so the branches below stay checked against the route.
type PostResult = Awaited<ReturnType<typeof api.v1.users.post>>;
type PostError = NonNullable<PostResult["error"]>;

export function CreateUserForm() {
  const queryClient = useQueryClient();
  const [message, setMessage] = useState<string | null>(null);

  const mutation = useMutation<void, PostError, CreateInput>({
    mutationFn: async (input) => {
      const { error } = await api.v1.users.post(input);
      // Eden returns errors instead of throwing; rethrow so TanStack Query
      // routes them to onError while keeping the discriminated union intact.
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage(null);
      // Targeted: refetch just the users query, not the whole RSC tree the way
      // router.refresh() did.
      queryClient.invalidateQueries({ queryKey: usersQueryOptions.queryKey });
    },
    onError: (error) => {
      switch (error.status) {
        case 409:
          setMessage(error.value.message);
          break;
        default:
          setMessage("Something went wrong. Try again.");
      }
    },
  });

  function onSubmit(formData: FormData) {
    setMessage(null);
    mutation.mutate({
      name: String(formData.get("name")),
      email: String(formData.get("email")),
    });
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
          disabled={mutation.isPending}
          className="rounded-md bg-neutral-900 px-4 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-white dark:text-neutral-900"
        >
          {mutation.isPending ? "Adding…" : "Add user"}
        </button>
      </div>

      {message && (
        <p className="mt-3 text-sm text-red-600 dark:text-red-400">{message}</p>
      )}
    </form>
  );
}
