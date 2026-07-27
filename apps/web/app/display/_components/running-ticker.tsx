"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import { Megaphone } from "lucide-react";

import { COLOR_VAL, type DeviceKind } from "@universe/contracts";

import { displayQueryOptions } from "@/lib/queries/display";

/**
 * The kiosk's running-text belt.
 *
 * Its content comes from `GET /v1/display/:kind`, which resolves the fallback
 * server-side: the device's own texts if it has any, the active master list if
 * it has none (design D8). The client does not know or need to know which of
 * the two it received.
 *
 * Polling this endpoint is also what makes a paired TV report in — the route
 * stamps `last_seen_at` on every device read — which is why the README's
 * standing "a paired TV always reads Offline" resolves here rather than in any
 * heartbeat-specific code. The missing piece was always a caller.
 *
 * An unpaired screen (opened by URL, no device session) gets a 401 and simply
 * shows no belt, rather than an error a passer-by would have to read.
 */
export function RunningTicker({ kind }: { kind: DeviceKind }) {
  const { data } = useQuery(displayQueryOptions(kind));
  const items = data?.runTexts ?? [];
  if (!items.length) return null;

  return (
    <div className="absolute inset-x-0 bottom-0 z-1 flex h-16 items-center gap-5 border-t border-(--glass-1-border) bg-(--glass-1-fill) px-14 backdrop-blur-md">
      <span className="grid size-10 flex-none place-items-center rounded-full border border-(--badge-info-border) bg-(--badge-info-fill)">
        <Megaphone className="size-5 text-primary-bright" />
      </span>
      <div className="relative min-w-0 flex-1 overflow-hidden">
        <div className="display-marquee w-max animate-[kmarquee_28s_linear_infinite] text-2xl whitespace-nowrap">
          {items.map((r, i) => (
            <React.Fragment key={`${r.text}-${i}`}>
              {i > 0 ? (
                <span className="mx-6 text-(--text-tertiary)">•</span>
              ) : null}
              {/* The colour vocabulary is the shared one, so a palette change
                  is a token change in contracts rather than a rewrite of every
                  stored row. */}
              <span style={{ color: COLOR_VAL[r.color] }}>{r.text}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}
