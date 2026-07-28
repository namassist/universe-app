"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

/**
 * Avatar inisial dengan gradient cyan + ring, atau foto bila ada.
 *
 * `src` is a variant of the same component rather than a second one: the ring,
 * the size, and the rounding are this element's identity, and a photo simply
 * replaces what fills it. The initials stay underneath as the fallback — an
 * employee row can carry a `photoFileName` whose file did not survive a
 * redeploy (design D8), so "the image failed to load" is a state that will
 * happen and must not render as a broken-image icon.
 */
function Avatar({
  className,
  src,
  alt,
  children,
  ...props
}: React.ComponentProps<"span"> & { src?: string | null; alt?: string }) {
  /**
   * Which URL failed, rather than a boolean.
   *
   * A replaced photo is a new URL, and a previous failure must not suppress it —
   * remembering *what* failed makes that fall out of the comparison instead of
   * needing an effect to reset a flag on every change of `src`.
   */
  const [failedSrc, setFailedSrc] = React.useState<string | null>(null);
  const showPhoto = !!src && failedSrc !== src;

  return (
    <span
      data-slot="avatar"
      className={cn(
        "relative grid size-9 place-items-center overflow-hidden rounded-full text-[13px] font-bold shadow-[0_0_0_2px_var(--ring-avatar)]",
        /* A photo replaces the placeholder rather than covering it: the gradient
           and the initials are gone, not hidden underneath. Anything else shows
           through a transparent PNG and flashes during the fetch. The neutral
           fill is what a photo with alpha sits on. */
        showPhoto
          ? "bg-(--fill-subtle)"
          : "bg-(image:--gradient-cta) text-on-cta",
        className
      )}
      {...props}
    >
      {showPhoto ? null : children}
      {showPhoto ? (
        /* Served by the API behind a session cookie, which the Next image
           optimizer cannot forward — no loader would make <Image> work here. */
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt ?? ""}
          onError={() => setFailedSrc(src)}
          className="absolute inset-0 size-full object-cover"
        />
      ) : null}
    </span>
  );
}

/* Ambil inisial dua kata pertama */
export function initialsOf(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}

export { Avatar };
