/**
 * Sending one slip to one printer, and giving up honestly.
 *
 * ESC/POS over a raw TCP socket on port 9100 — the way every printer on this
 * site is already driven. There is no protocol to speak: the bytes are the
 * document, and a printer that accepted them prints.
 *
 * **A tap is attendance whatever the printer does.** Nothing here is allowed to
 * throw into the path that records a tap; the worst outcome is a ticket marked
 * failed and waiting for somebody to press reprint.
 */

import net from "node:net";

/** Long enough for a slip, short enough that a dead printer is not a wait. */
const CONNECT_TIMEOUT_MS = 4000;

export type PrintOutcome =
  { sent: true; ms: number } | { sent: false; reason: string; ms: number };

/** One attempt. Resolves either way — a refused printer is an answer. */
export function sendToPrinter(
  ip: string,
  port: number,
  bytes: Buffer
): Promise<PrintOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (outcome: PrintOutcome) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(outcome);
    };

    socket.setTimeout(CONNECT_TIMEOUT_MS);
    /* Every failure path ends here rather than as an unheard `error` event —
       the mistake that took the whole API down on 2026-09-12. */
    socket.on("error", (error: NodeJS.ErrnoException) =>
      finish({
        sent: false,
        reason: error.code ?? error.message,
        ms: Date.now() - started,
      })
    );
    socket.on("timeout", () =>
      finish({ sent: false, reason: "TIMEOUT", ms: Date.now() - started })
    );

    socket.connect(port, ip, () => {
      socket.write(bytes, () =>
        finish({ sent: true, ms: Date.now() - started })
      );
    });
  });
}

export type PrintAttempt = (bytes: Buffer) => Promise<PrintOutcome>;

/**
 * Try for about a minute, then stop and say so.
 *
 * A minute is what the owner asked for: long enough to cover a printer being
 * switched on or a cable reseated, short enough that nothing prints unattended
 * after the person has walked away (owner, 2026-09-13). What follows a failure
 * is a row marked failed and a reprint button, not a queue that fires later at
 * an empty booth.
 */
export async function printWithRetry(
  attempt: PrintAttempt,
  bytes: Buffer,
  options: { forMs?: number; gapMs?: number; now?: () => number } = {}
): Promise<{ outcome: PrintOutcome; attempts: number }> {
  const forMs = options.forMs ?? 60_000;
  const gapMs = options.gapMs ?? 5_000;
  const now = options.now ?? Date.now;
  const until = now() + forMs;

  let attempts = 0;
  let last: PrintOutcome = { sent: false, reason: "belum dicoba", ms: 0 };

  for (;;) {
    attempts += 1;
    last = await attempt(bytes);
    if (last.sent) return { outcome: last, attempts };
    if (now() + gapMs >= until) return { outcome: last, attempts };
    await Bun.sleep(gapMs);
  }
}
