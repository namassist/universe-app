"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";

import type { DeviceKind } from "@universe/contracts";

import { fetchBlob } from "@/lib/api";
import { displayQueryOptions } from "@/lib/queries/display";

/**
 * The timeline's sound, played by the screen the speaker is plugged into.
 *
 * The server names the cue and the instant — see `sound-cue.ts` on the API —
 * and this only obeys. Two things it must get right:
 *
 * **The instant, not the arrival.** The poll is a minute wide, so a cue
 * usually arrives before it is due. The wait is measured from the response's
 * own clock (`playAt - servedAt`) minus however long the response has been
 * sitting here, so the sound lands on the second whatever this screen's clock
 * says — a kiosk left running for weeks drifts, and the muster does not.
 *
 * **Once.** A cue is identified by stage and date, and a played one is
 * remembered for the life of the page, so the poll offering it again for the
 * minute before it fires cannot sound twice.
 */
export function useSoundCue(kind: DeviceKind) {
  const { data, dataUpdatedAt } = useQuery(displayQueryOptions(kind));
  const cue = data?.cue ?? null;
  const servedAt = data?.servedAt ?? null;

  const played = React.useRef(new Set<string>());
  /* The browser refuses audio until somebody has interacted with the page, and
     a kiosk that rebooted overnight has nobody to interact with it. When that
     happens the screen says so rather than going quietly silent. */
  const [blocked, setBlocked] = React.useState(false);

  React.useEffect(() => {
    if (!cue || !servedAt || played.current.has(cue.id)) return;

    const untilDue =
      new Date(cue.playAt).getTime() - new Date(servedAt).getTime();
    const waited = Date.now() - dataUpdatedAt;
    const delay = Math.max(0, untilDue - waited);

    let audio: HTMLAudioElement | null = null;
    let url: string | null = null;
    const timer = setTimeout(() => {
      played.current.add(cue.id);
      /* Fetched rather than pointed at: the bytes are behind the screen's own
         session, and this is the convention the rest of the app follows for
         anything binary (`fetchBlob`). */
      void fetchBlob(`/v1/sounds/${cue.soundId}/file`)
        .then((blob) => {
          url = URL.createObjectURL(blob);
          audio = new Audio(url);
          return audio.play();
        })
        .then(() => setBlocked(false))
        .catch(() => setBlocked(true));
    }, delay);

    return () => {
      clearTimeout(timer);
      audio?.pause();
      if (url) URL.revokeObjectURL(url);
    };
  }, [cue, servedAt, dataUpdatedAt]);

  /**
   * Take the browser's permission while somebody is standing here.
   *
   * Playing anything at all on a real click is what lifts the autoplay block
   * for the rest of the page's life; a muted clip does it without a noise
   * nobody asked for.
   */
  const unlock = React.useCallback(() => {
    const audio = new Audio();
    audio.muted = true;
    void audio
      .play()
      .then(() => setBlocked(false))
      .catch(() => setBlocked(false));
  }, []);

  return { blocked, unlock };
}
