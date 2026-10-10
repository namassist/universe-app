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

/** Long enough for a slip, short enough that a dead printer is not a wait. */
const CONNECT_TIMEOUT_MS = 4000;

/**
 * How long to wait, after our FIN, for the printer to close its side.
 *
 * A printer closes once the job is in. One that holds the connection open is
 * let go after this with the slip counted as sent: every byte was flushed and
 * nothing came back as an error.
 */
const CLOSE_GRACE_MS = 3000;

export type PrintOutcome =
  { sent: true; ms: number } | { sent: false; reason: string; ms: number };

/**
 * One attempt. Resolves either way — a refused printer is an answer.
 *
 * **Bun's own socket, not `node:net`.** On 2026-10-10 most booth printers
 * showed "Tercetak" and printed nothing. The send used `node:net` and
 * `destroy()`ed the socket in the `write` callback — and under Bun that
 * callback, like `connect`, fires before the bytes have left; a test even saw
 * a closed port reported as a successful send. Destroying there throws away
 * whatever is still queued, which on a loopback is nothing and on a site
 * radio link can be the whole slip. Measured on loopback with a 64 KB slip:
 * `node:net` `end(bytes)` lost data 25 times in 25 and `Bun.connect` with a
 * bare `end()` 24 in 25; `Bun.connect` with `flush()` then `shutdown()` (a FIN,
 * the socket still open to read) and waiting for the printer to close lost
 * none. That last one is what this does. `Bun.connect` also reports a refused
 * port as one.
 *
 * Sent means every byte was handed over and the connection then closed
 * without an error — never merely that a write was attempted.
 */
export function sendToPrinter(
  ip: string,
  port: number,
  bytes: Buffer
): Promise<PrintOutcome> {
  const started = Date.now();
  return new Promise((resolve) => {
    let settled = false;
    let flushed = false;
    let pending = new Uint8Array(bytes);
    const finish = (outcome: PrintOutcome) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };
    const failed = (reason: string) =>
      finish({ sent: false, reason, ms: Date.now() - started });
    const codeOf = (error: unknown) =>
      (error as NodeJS.ErrnoException)?.code ??
      (error as Error)?.message ??
      "ERROR";

    type Sock = {
      write(b: Uint8Array): number;
      flush(): void;
      shutdown(): void;
      end(): void;
      terminate(): void;
    };
    let socket: Sock | null = null;
    /* Until every byte is out this is a failure; afterwards it is only the
       printer not closing its side, which `CLOSE_GRACE_MS` forgives. */
    let timer = setTimeout(() => {
      socket?.terminate();
      failed("TIMEOUT");
    }, CONNECT_TIMEOUT_MS);

    /* Writes what the socket will take; a slip larger than one write is
       finished from `drain`. Once nothing is left: flush, then FIN. */
    const pump = (s: Sock) => {
      if (flushed) return;
      const wrote = s.write(pending);
      if (wrote < 0) return failed("WRITE");
      pending = pending.subarray(wrote);
      if (pending.length) return;
      flushed = true;
      s.flush();
      s.shutdown();
      clearTimeout(timer);
      timer = setTimeout(() => {
        socket?.end();
        finish({ sent: true, ms: Date.now() - started });
      }, CLOSE_GRACE_MS);
    };

    Bun.connect({
      hostname: ip,
      port,
      socket: {
        open(s) {
          socket = s;
          pump(s);
        },
        drain(s) {
          pump(s);
        },
        /* Read and dropped: a printer may answer with a status byte. */
        data() {},
        /* The printer has the job and closed its side; close ours. */
        end(s) {
          s.end();
        },
        close() {
          if (flushed) finish({ sent: true, ms: Date.now() - started });
          else failed("CLOSED");
        },
        error(_s, error) {
          failed(codeOf(error));
        },
        connectError(_s, error) {
          failed(codeOf(error));
        },
      },
    }).catch((error) => failed(codeOf(error)));
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
