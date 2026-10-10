/**
 * Sending a slip, and letting go of the printer properly.
 *
 * On 2026-10-10 most booth printers took their slips — the screen said
 * "Tercetak" — and printed nothing. The send closed with `destroy()` straight
 * after the write. A printer that answers on connect (a status byte) leaves
 * unread data in our socket, and closing such a socket resets it, which can
 * throw away what has not reached the printer yet. So the send now reads what
 * the printer says, ends with a FIN, and waits for the printer to finish.
 *
 * A loopback server stands in for the printer; nothing here leaves the host.
 */

import { afterEach, describe, expect, test } from "bun:test";
import net from "node:net";

import { sendToPrinter } from "./ticket-printer";

type Fake = {
  port: number;
  received: () => Buffer;
  /** How the printer saw the connection end: a FIN, or a reset. */
  ending: Promise<"fin" | "reset">;
  close: () => Promise<void>;
};

/** A printer that greets every connection with a status byte, as some do. */
async function fakePrinter(greet = true): Promise<Fake> {
  const chunks: Buffer[] = [];
  let settle: (how: "fin" | "reset") => void = () => {};
  const ending = new Promise<"fin" | "reset">((r) => (settle = r));
  const server = net.createServer((socket) => {
    if (greet) socket.write(Buffer.from([0x12]));
    socket.on("data", (d) => chunks.push(d));
    socket.on("end", () => {
      settle("fin");
      socket.end();
    });
    socket.on("error", () => settle("reset"));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const port = (server.address() as net.AddressInfo).port;
  return {
    port,
    received: () => Buffer.concat(chunks),
    ending,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

let printer: Fake | null = null;
afterEach(async () => {
  await printer?.close();
  printer = null;
});

describe("sending one slip", () => {
  test("every byte arrives, and the connection ends with a FIN, not a reset", async () => {
    printer = await fakePrinter();
    const slip = Buffer.alloc(64 * 1024, 0x41);

    const outcome = await sendToPrinter("127.0.0.1", printer.port, slip);

    expect(outcome.sent).toBe(true);
    expect(await printer.ending).toBe("fin");
    expect(printer.received().length).toBe(slip.length);
  });

  test("a printer that says nothing back is sent to just the same", async () => {
    printer = await fakePrinter(false);
    const slip = Buffer.from("TES\r\n", "latin1");

    const outcome = await sendToPrinter("127.0.0.1", printer.port, slip);

    expect(outcome.sent).toBe(true);
    /* In one process Bun runs the client's events before the server's, so
       read what the printer got once it has seen our FIN. */
    expect(await printer.ending).toBe("fin");
    expect(printer.received().toString("latin1")).toBe("TES\r\n");
  });

  /* Port 1, where nothing listens. A port freed by `server.close()` would not
     do: Bun runs the close callback before it lets go of the port, and a
     connect straight after is still accepted. */
  test("a refused printer is an answer, not a throw", async () => {
    const outcome = await sendToPrinter("127.0.0.1", 1, Buffer.from("x"));

    expect(outcome.sent).toBe(false);
    if (!outcome.sent) expect(outcome.reason).toBe("ECONNREFUSED");
  });
});
