import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * The design system's own radius scale, declared to tailwind-merge.
 *
 * Without this, `cn("rounded-full", "rounded-card")` keeps *both*: tailwind-merge
 * only collapses classes whose values it recognises, and `card` is not part of
 * Tailwind's stock radius scale. Two rules then reach the element and the winner
 * is whichever the compiler emitted last, not the one the caller asked for —
 * which is why `Avatar`'s square variant had been rendering as a circle.
 *
 * Keep this list in step with the `--radius-*` tokens in `globals.css`.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      radius: ["chip", "control", "icon", "card", "panel"],
    },
  },
});

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
