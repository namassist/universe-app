"use client";

import * as React from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Camera,
  CameraOff,
  IdCard as IdCardIcon,
  ScanLine,
} from "lucide-react";

import { SHIFT_KIND_LABELS } from "@universe/contracts";

import { isStatus } from "@/lib/api";
import { useI18n } from "@/lib/i18n";
import {
  idCardPhotoUrl,
  idCardQueryOptions,
  type IdCard as IdCardData,
} from "@/lib/queries/id-card";
import { cn } from "@/lib/utils";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PageTitle, Panel, SectionTitle } from "@/components/ui/panel";
import { StateBox } from "@/components/ui/state-box";

import { nikOfScan, shouldLookUp } from "./scan-id-rules";

/**
 * Scan ID Card — a card held up to a phone at the gate.
 *
 * The QR code on the card carries the NIK; this answers who that is and what
 * the muster gave them today. Read on a phone, so the camera is the subject of the page
 * and everything else stacks under it at one column.
 *
 * **The camera needs a secure origin.** Browsers refuse `getUserMedia` over
 * plain HTTP — which is what this installation is served over until the tunnel
 * lands (see `docs/deploy.md`) — so the manual NIK field is not a fallback for
 * a broken card only: on an insecure origin it is the whole screen, and the
 * page says why rather than showing a camera that can never start.
 *
 * Decoding is the platform's `BarcodeDetector` where it exists (Chrome on
 * Android), and a WebAssembly polyfill loaded on demand where it does not
 * (Safari). Nothing is imported until the camera is actually started, so a
 * phone that only ever types a NIK downloads none of it.
 */

/** What the scanner is doing, and why it is not doing it. */
type ScanState =
  | { kind: "off" }
  | { kind: "starting" }
  | { kind: "running" }
  | { kind: "failed"; reason: "denied" | "insecure" | "none" };

/**
 * What the cards carry (owner, 2026-09-21).
 *
 * QR alone, not every symbology a decoder knows: each extra format is another
 * pass over every frame, and a screen that also read the 1D barcode on a
 * parcel label would answer confidently about the wrong thing.
 */
const FORMATS = ["qr_code"];

type Detector = {
  detect: (source: CanvasImageSource) => Promise<{ rawValue: string }[]>;
};

/** The platform's detector, or the polyfill where there is none. */
async function makeDetector(): Promise<Detector> {
  const native = (
    globalThis as { BarcodeDetector?: new (o: object) => Detector }
  ).BarcodeDetector;
  if (native) return new native({ formats: FORMATS });
  const { BarcodeDetector } = await import("barcode-detector/pure");
  /* The polyfill types its formats as its own literal union; the list above
     is that same set, kept as plain strings so the native path needs no
     import of the polyfill's types. */
  return new BarcodeDetector({
    formats: FORMATS as never,
  }) as unknown as Detector;
}

/* No `mode`: the screen reads and writes nothing, so `view` and `manage` are
   the same screen — as on the dashboard. */
export function ScanIdMenu() {
  const { t } = useI18n();
  const videoRef = React.useRef<HTMLVideoElement>(null);
  const streamRef = React.useRef<MediaStream | null>(null);
  const [scan, setScan] = React.useState<ScanState>({ kind: "off" });
  const [nik, setNik] = React.useState<string | null>(null);
  const [typed, setTyped] = React.useState("");

  /* The reading the camera is on now, in a ref rather than state: the decode
     loop compares against it many times a second, and every comparison that
     re-rendered would be a wasted render. */
  const showingRef = React.useRef<string | null>(null);
  const look = React.useCallback((reading: string) => {
    const found = nikOfScan(reading);
    if (!found || !shouldLookUp(found, showingRef.current)) return;
    showingRef.current = found;
    setNik(found);
  }, []);

  /* Whether this screen is still on. Read after every await in `start`: a
     camera that arrives for a screen nobody is looking at is stopped at once
     rather than stored, which is the only way the cleanup below can promise
     anything — it runs while `getUserMedia` is still in flight, when there is
     nothing yet to stop. */
  const liveRef = React.useRef(true);

  const stop = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    setScan({ kind: "off" });
  }, []);

  const start = React.useCallback(async () => {
    // Secure-origin check first: the browser's own error for this is a bare
    // "undefined is not an object", which says nothing to the person holding
    // the phone.
    if (!globalThis.isSecureContext || !navigator.mediaDevices?.getUserMedia)
      return setScan({ kind: "failed", reason: "insecure" });

    setScan({ kind: "starting" });
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        // The back camera: a card is held away from the face.
        video: { facingMode: { ideal: "environment" } },
      });
      if (!liveRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }
      if (!liveRef.current) return stop();
      setScan({ kind: "running" });
    } catch (error) {
      const name = (error as { name?: string }).name;
      setScan({
        kind: "failed",
        reason: name === "NotFoundError" ? "none" : "denied",
      });
    }
  }, [stop]);

  /* One decode loop for as long as the camera runs; it owns the detector, so
     the polyfill is fetched once and dropped with the camera. */
  React.useEffect(() => {
    if (scan.kind !== "running") return;
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    void (async () => {
      const detector = await makeDetector();
      const read = async () => {
        if (!live) return;
        const video = videoRef.current;
        if (video && video.readyState >= 2) {
          try {
            for (const found of await detector.detect(video))
              look(found.rawValue);
          } catch {
            // A frame that cannot be decoded is the normal case, not an error.
          }
        }
        // Four looks a second: fast enough to feel instant, slow enough to
        // leave a mid-range phone's battery alone.
        timer = setTimeout(() => void read(), 250);
      };
      await read();
    })();

    return () => {
      live = false;
      if (timer) clearTimeout(timer);
    };
  }, [scan.kind, look]);

  /* The camera must not outlive the screen — a page left on a phone with the
     torch of a running stream is exactly the complaint this avoids. The flag
     covers the gap the cleanup alone cannot: leaving while the permission
     prompt is still up, when there is no stream yet to stop. */
  React.useEffect(() => {
    liveRef.current = true;
    return () => {
      liveRef.current = false;
      stop();
    };
  }, [stop]);

  const card = useQuery(idCardQueryOptions(nik));
  const unknown = isStatus(card.error, 404);

  const submitTyped = (e: React.FormEvent) => {
    e.preventDefault();
    const found = nikOfScan(typed);
    if (!found) return;
    showingRef.current = found;
    setNik(found);
  };

  return (
    <>
      <PageTitle title={t.scanTitle} sub={t.scanLead} />

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel className="flex flex-col gap-4 p-5">
          <SectionTitle>{t.scanTitle}</SectionTitle>

          <div className="relative aspect-[4/3] w-full overflow-hidden rounded-card border border-(--divider) bg-(--fill-input)">
            <video
              ref={videoRef}
              muted
              playsInline
              className={cn(
                "size-full object-cover",
                scan.kind === "running" ? "" : "hidden"
              )}
            />
            {scan.kind === "running" ? (
              /* A guide rather than a decoration: people aim the card at it,
                 so it is the shape of the thing being aimed — a square, since
                 a QR code is one. Sized off the frame's short side so it stays
                 square and well inside the picture at any phone's aspect. */
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="aspect-square h-[72%] rounded-card border-2 border-(--color-primary) shadow-[0_0_0_9999px_rgba(0,0,0,.35)]" />
              </div>
            ) : (
              <div className="grid size-full place-items-center p-6 text-center text-(--text-secondary)">
                <div className="flex flex-col items-center gap-3">
                  <ScanLine className="size-10" />
                  <span>
                    {scan.kind === "failed"
                      ? scan.reason === "insecure"
                        ? t.scanInsecure
                        : scan.reason === "none"
                          ? t.scanNoCamera
                          : t.scanDenied
                      : t.scanLead}
                  </span>
                </div>
              </div>
            )}
          </div>

          <Button
            type="button"
            variant={scan.kind === "running" ? "secondary" : "primary"}
            onClick={scan.kind === "running" ? stop : () => void start()}
            disabled={scan.kind === "starting"}
          >
            {scan.kind === "running" ? (
              <>
                <CameraOff /> {t.scanStop}
              </>
            ) : (
              <>
                <Camera /> {t.scanStart}
              </>
            )}
          </Button>

          {/* Beside the camera, not behind it: a scuffed QR code, a desk with
              no camera, and a USB scanner that types the number all end here. */}
          <form className="flex gap-3" onSubmit={submitTyped}>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder={t.scanManualPh}
              inputMode="numeric"
              aria-label={t.scanManual}
              className="font-mono"
            />
            <Button type="submit" variant="secondary" disabled={!typed.trim()}>
              {t.scanLookUp}
            </Button>
          </form>
        </Panel>

        {/* The same height as the camera beside it (owner, 2026-09-21):
            two panels of one height read as one screen, so the card is
            centred in its half rather than pinned to the top of it. */}
        <Panel className="flex flex-col justify-center p-5">
          {card.data ? (
            <IdCardView card={card.data} />
          ) : (
            <StateBox
              icon={<IdCardIcon />}
              title={unknown ? t.scanNotFound : t.scanIdle}
            />
          )}
        </Panel>
      </div>
    </>
  );
}

/**
 * The card itself, as design option 6 — "Access Badge" (owner, 2026-09-21).
 *
 * A badge, centred: the strip naming what this is, the face, who they are,
 * then the two things a gate acts on — roster and shift — as tiles, the rest
 * of the muster's answer beneath them, and the qualifications last. Their
 * layout, drawn in this app's own tokens and components.
 */
function IdCardView({ card }: { card: IdCardData }) {
  const { t } = useI18n();
  return (
    <div className="flex flex-col items-center p-2 text-center">
      <div className="mb-4 flex w-full justify-between font-mono text-xs font-bold text-(--text-tertiary)">
        <span>ACCESS CARD</span>
        <span className="tabular-nums">{card.nik}</span>
      </div>

      <Avatar
        className="size-24 text-3xl"
        src={idCardPhotoUrl(card)}
        alt={card.name}
      >
        {card.name}
      </Avatar>

      <div className="mt-4 w-full min-w-0">
        <h2 className="text-base font-bold break-words uppercase">
          {card.name}
        </h2>
        <p className="mt-1 font-mono text-xs text-(--text-tertiary) tabular-nums">
          NIK {card.nik}
        </p>
        <p className="mt-2 text-sm font-semibold text-(--text-secondary)">
          {card.department ?? "-"}
        </p>
        <p className="mt-1 text-xs text-(--text-tertiary)">
          {card.position ?? "-"}
        </p>
      </div>

      {/* The two a gate acts on, given tiles of their own. */}
      <div className="mt-5 grid w-full grid-cols-2 gap-3">
        <div className="rounded-card bg-(--fill-subtle) p-3">
          <Fact label={t.scanRoster} value={card.roster} strong />
        </div>
        <div className="rounded-card bg-(--fill-subtle) p-3">
          <Fact
            label={t.scanShift}
            value={card.shift ? (SHIFT_KIND_LABELS[card.shift] ?? null) : null}
            strong
          />
        </div>
      </div>

      {/* The whole of the muster's answer, three across, as the layout has
          it — roster and shift included, though the tiles above lead with
          them: the tiles are what the gate reads, this is the record. */}
      <dl className="mt-5 grid w-full grid-cols-3 gap-x-4 gap-y-5 text-left">
        <Fact label={t.scanRoster} value={card.roster} />
        <Fact
          label={t.scanShift}
          value={card.shift ? (SHIFT_KIND_LABELS[card.shift] ?? null) : null}
        />
        <Fact label={t.scanCheckIn} value={card.checkInAt} mono />
        <Fact label={t.scanUnit} value={card.unit} />
        <Fact label={t.scanArea} value={card.area} />
        <Fact label={t.scanBus} value={card.bus} />
      </dl>

      <div className="mt-5 w-full">
        <SimperCodes codes={card.simper} />
      </div>
    </div>
  );
}

/**
 * The qualifications, as chips.
 *
 * Five, then a button for the rest: an operator holding ten codes is ordinary,
 * and a card listing all of them would push what a gate acts on off a phone
 * screen. A button rather than the reference's hover tooltip, because the
 * screen this is read on has no pointer to hover with.
 */
function SimperCodes({ codes }: { codes: string[] }) {
  const { t } = useI18n();
  const [all, setAll] = React.useState(false);
  const shown = all ? codes : codes.slice(0, 5);
  const rest = codes.length - shown.length;

  return (
    <div className="text-center">
      <p className="mb-2 text-[11px] font-semibold text-(--text-tertiary) uppercase">
        {t.scanSimper}
      </p>
      <div className="flex flex-wrap justify-center gap-1.5">
        {codes.length === 0 ? (
          <span className="text-sm font-semibold">-</span>
        ) : (
          shown.map((code) => (
            <span
              key={code}
              className="rounded-full border border-(--divider) bg-(--fill-subtle) px-2.5 py-1 font-mono text-[11px] text-(--text-secondary)"
            >
              {code}
            </span>
          ))
        )}
        {rest > 0 ? (
          <button
            type="button"
            onClick={() => setAll(true)}
            className="rounded-full bg-(image:--gradient-cta) px-2.5 py-1 text-[11px] font-bold text-(--color-on-cta)"
          >
            {t.scanMore} +{rest}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function Fact({
  label,
  value,
  mono = false,
  strong = false,
}: {
  label: string;
  value: string | null;
  mono?: boolean;
  /** Roster and shift, in their own tiles: what a gate reads first. */
  strong?: boolean;
}) {
  const shown = value?.trim() || "-";
  return (
    <div className="min-w-0">
      <dt className="text-[11px] font-semibold text-(--text-tertiary) uppercase">
        {label}
      </dt>
      <dd
        className={cn(
          "mt-1 truncate",
          strong
            ? "text-base font-bold text-(--color-primary-bright)"
            : "text-sm font-semibold",
          mono && "font-mono tabular-nums"
        )}
        title={shown}
      >
        {shown}
      </dd>
    </div>
  );
}
