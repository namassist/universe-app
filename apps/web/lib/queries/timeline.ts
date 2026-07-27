import { queryOptions } from "@tanstack/react-query";

import { api, unwrap } from "@/lib/api";

export const timelineKey = ["timeline"] as const;

export const timelineQueryOptions = () =>
  queryOptions({
    queryKey: timelineKey,
    queryFn: () => unwrap(api.v1.timeline.get()),
  });

export type TimelineStageRow = Awaited<
  ReturnType<NonNullable<ReturnType<typeof timelineQueryOptions>["queryFn"]>>
>[number];
