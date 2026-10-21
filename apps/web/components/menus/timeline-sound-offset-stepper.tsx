"use client";

import { Minus, Plus } from "lucide-react";

import { SOUND_OFFSET_MAX, SOUND_OFFSET_MIN } from "@universe/contracts";

import { fmt, soundOffsetText, useI18n } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { IconButton } from "@/components/ui/button";

import { soundTimeFor, stepSoundOffset } from "./timeline-sound-offset";

/**
 * `[−] −2 [+] menit` — when a stage's sound plays, moved one minute per
 * press, never typed (owner, 2026-10-10). The number is a spinbutton for
 * assistive tech and the arrow keys; the line under it says the same thing
 * in words and the clock time it lands on.
 */
function SoundOffsetStepper({
  id,
  value,
  at,
  onChange,
  className,
}: {
  id: string;
  value: number;
  /** The stage's own `HH:MM`, for the preview. */
  at: string;
  onChange: (next: number) => void;
  className?: string;
}) {
  const { t } = useI18n();
  const step = (delta: 1 | -1) => onChange(stepSoundOffset(value, delta));
  const plays = soundTimeFor(at, value);
  const shown = value > 0 ? `+${value}` : String(value);

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <div className="flex items-center gap-2">
        <IconButton
          type="button"
          aria-label={t.sndEarlier}
          disabled={value <= SOUND_OFFSET_MIN}
          onClick={() => step(-1)}
          className="disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Minus />
        </IconButton>
        <div
          id={id}
          role="spinbutton"
          tabIndex={0}
          aria-label={t.sndStepperAria}
          aria-valuemin={SOUND_OFFSET_MIN}
          aria-valuemax={SOUND_OFFSET_MAX}
          aria-valuenow={value}
          aria-valuetext={soundOffsetText(t, value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowUp" || e.key === "ArrowRight") {
              e.preventDefault();
              step(1);
            } else if (e.key === "ArrowDown" || e.key === "ArrowLeft") {
              e.preventDefault();
              step(-1);
            }
          }}
          className="flex h-9 w-14 items-center justify-center rounded-control border border-(--glass-1-border) bg-(--fill-subtle) font-mono text-sm font-semibold tabular-nums select-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          {shown}
        </div>
        <IconButton
          type="button"
          aria-label={t.sndLater}
          disabled={value >= SOUND_OFFSET_MAX}
          onClick={() => step(1)}
          className="disabled:cursor-not-allowed disabled:opacity-40"
        >
          <Plus />
        </IconButton>
        <span className="text-sm text-(--text-secondary)">{t.sndMinutes}</span>
      </div>
      <p className="text-xs text-(--text-tertiary)">
        {soundOffsetText(t, value)}
        {plays ? ` ${fmt(t.sndPlaysAt, { at: plays })}` : ""}
      </p>
    </div>
  );
}

export { SoundOffsetStepper };
