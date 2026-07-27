import { queryOptions } from "@tanstack/react-query";

import { api, API_URL, unwrap } from "@/lib/api";

export const soundsKey = ["sounds"] as const;

export const soundsQueryOptions = () =>
  queryOptions({
    queryKey: soundsKey,
    queryFn: () => unwrap(api.v1.sounds.get({ query: {} })),
  });

export type SoundRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof soundsQueryOptions>["queryFn"]>>
>[number];

/**
 * Where an `<audio>` element or `new Audio()` fetches a sound's bytes.
 *
 * A URL rather than a fetched blob: the browser streams it, honours range
 * requests, and starts playing before the whole clip has arrived — which is the
 * same reason the API serves it with `Bun.file` rather than buffering it.
 */
export const soundFileUrl = (id: string) => `${API_URL}/v1/sounds/${id}/file`;
