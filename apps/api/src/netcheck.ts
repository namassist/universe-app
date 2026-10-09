/**
 * "Which of these booths is the problem?" — the on-demand network check.
 *
 * The prober (`prober.ts`) answers one question continuously: does port 4370
 * accept a connection. That is enough for the wall, and too little for the
 * technician walking to a booth, who wants what the site's `netcheck.sh`
 * prints: ping and both ports of the machine, ping and the raw port of its
 * printer, each on its own. A machine that drops ICMP but answers 4370 (MAIN
 * OFFICE does) is healthy; a machine that pings but refuses 4370 has a hung
 * firmware. Folding those into one verdict would hide exactly what the check
 * is for, so every result is reported separately.
 *
 * Unlike the prober this runs on a request and does wait on hardware — that is
 * its purpose, and a person clicked a button to ask. It writes nothing: the
 * wall's online/offline stays the prober's debounced reading.
 */

import net from "node:net";

/** The ZK protocol port, fixed in device firmware. */
export const ZK_PORT = 4370;

/** As in `netcheck.sh`: three seconds is plenty on the site LAN. */
const TCP_TIMEOUT_MS = 3000;

/** Two one-second echoes need ~2 s; anything past this is a hung process. */
const PING_KILL_MS = 5000;

/**
 * `unavailable` is "could not ask", not "asked and got no answer" — a host
 * without the `ping` binary must not paint every machine red.
 */
export type CheckStatus = "ok" | "fail" | "unavailable";

export type NetProbes = {
  ping: (ip: string) => Promise<CheckStatus>;
  tcp: (ip: string, port: number) => Promise<boolean>;
};

export type CheckTarget = {
  ip: string;
  /** The machine's SOAP port, per machine (`fingerprint_machines.port`). */
  port: number;
  printer: { ip: string; port: number } | null;
};

export type CheckResult = {
  finger: {
    ip: string;
    port: number;
    ping: CheckStatus;
    web: CheckStatus;
    zk: CheckStatus;
  };
  printer: {
    ip: string;
    port: number;
    ping: CheckStatus;
    raw: CheckStatus;
  } | null;
};

/**
 * One TCP connect, resolved as reachable/unreachable and never rejected.
 *
 * Every exit path destroys the socket. A host that accepts the SYN and then
 * says nothing would otherwise hold a file descriptor open for the OS timeout.
 */
export const tcpReachable = (
  ip: string,
  port: number,
  timeoutMs: number
): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;
    const finish = (reachable: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve(reachable);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, ip);
  });

/**
 * Two echo requests, one second each — the script's `ping -c 2 -W 1`.
 *
 * Spawned with an argument array, never a shell, and only ever with an address
 * the registry already validated as IPv4. iputils exits 1 when no reply came
 * and 2 on any other error (no permission, no route), so only 1 is a `fail`;
 * a missing binary or exit 2 is `unavailable`.
 */
export async function icmpPing(ip: string): Promise<CheckStatus> {
  try {
    const proc = Bun.spawn(["ping", "-c", "2", "-W", "1", ip], {
      stdout: "ignore",
      stderr: "ignore",
      // Normally done in ~2 s; a ping that hangs is killed, never left behind.
      timeout: PING_KILL_MS,
    });
    const code = await proc.exited;
    if (code === 0) return "ok";
    return code === 1 ? "fail" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export const realProbes: NetProbes = {
  ping: icmpPing,
  tcp: (ip, port) => tcpReachable(ip, port, TCP_TIMEOUT_MS),
};

const tcpStatus = async (
  probes: NetProbes,
  ip: string,
  port: number
): Promise<CheckStatus> => ((await probes.tcp(ip, port)) ? "ok" : "fail");

/** Every check of one machine and its printer, run side by side. */
export async function checkTarget(
  target: CheckTarget,
  probes: NetProbes = realProbes
): Promise<CheckResult> {
  const { printer } = target;
  const [ping, web, zk, printerPing, raw] = await Promise.all([
    probes.ping(target.ip),
    tcpStatus(probes, target.ip, target.port),
    tcpStatus(probes, target.ip, ZK_PORT),
    printer ? probes.ping(printer.ip) : null,
    printer ? tcpStatus(probes, printer.ip, printer.port) : null,
  ]);

  return {
    finger: { ip: target.ip, port: target.port, ping, web, zk },
    printer:
      printer && printerPing && raw
        ? { ip: printer.ip, port: printer.port, ping: printerPing, raw }
        : null,
  };
}
