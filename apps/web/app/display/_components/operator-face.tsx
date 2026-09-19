"use client";

import * as React from "react";

import { cn } from "@/lib/utils";
import { initialsOf } from "@/components/ui/avatar";

/**
 * A person's photograph filling its box, with their initials underneath.
 *
 * Underneath rather than instead: a wall runs unattended for weeks, and every
 * way a photo can fail to arrive — no file on the volume, the API unreachable
 * between polls, a face added to the register after this card was drawn — must
 * land on the initials rather than on a broken-image glyph six metres up. The
 * failure is remembered by URL, as `<Avatar>` does it, so a replaced photo is
 * tried again instead of being suppressed by the previous one's failure.
 *
 * Shared by the fleet wall's unit cards and the attendance wall's tickets. The
 * box it fills is the caller's: it is absolutely positioned over its parent.
 */
function OperatorFace({
  name,
  src,
  compact = false,
  initialsClassName,
}: {
  name: string;
  src: string | null;
  compact?: boolean;
  /** Overrides the initials' size where the box is not a unit card's. */
  initialsClassName?: string;
}) {
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const showPhoto = !!src && failedSrc !== src;

  return (
    <div className="absolute inset-0 grid place-items-center bg-(image:--gradient-cta)">
      {showPhoto ? (
        /* Served by the API behind a session cookie, which the Next image
           optimizer cannot forward — no loader would make <Image> work here. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={name}
          onError={() => setFailedSrc(src)}
          /* Top-weighted, because a mugshot is framed on the face and the
             bottom of the card is under the scrim that carries the name. */
          className="absolute inset-0 size-full object-cover object-top"
        />
      ) : (
        <span
          className={cn(
            "font-bold text-(--color-on-cta) opacity-80",
            compact ? "text-[44px]" : "text-[88px]",
            initialsClassName
          )}
        >
          {initialsOf(name)}
        </span>
      )}
    </div>
  );
}

export { OperatorFace };
