import { queryOptions } from "@tanstack/react-query";

import { api, API_URL, unwrap } from "@/lib/api";

/**
 * One scanned ID card.
 *
 * No polling: a card is a question asked once, when it is held up to the
 * camera. The answer is kept for a minute so a card scanned twice in a row —
 * the usual thing at a gate — does not go back to the server.
 */
export const idCardKey = (nik: string) => ["id-card", nik] as const;

export const idCardQueryOptions = (nik: string | null) =>
  queryOptions({
    queryKey: idCardKey(nik ?? ""),
    queryFn: () => unwrap(api.v1["id-card"]({ nik: nik! }).get()),
    enabled: !!nik,
    staleTime: 60_000,
    retry: false,
  });

export type IdCard = Awaited<
  ReturnType<NonNullable<ReturnType<typeof idCardQueryOptions>["queryFn"]>>
>;

/**
 * Where a card's photograph comes from, or null when there is none on file.
 *
 * The API names the path (the scan screen's own route, with the file name as
 * a cache-buster); the browser only puts the API's origin in front of it.
 */
export function idCardPhotoUrl(card: {
  photoUrl: string | null;
}): string | null {
  return card.photoUrl ? `${API_URL}${card.photoUrl}` : null;
}
