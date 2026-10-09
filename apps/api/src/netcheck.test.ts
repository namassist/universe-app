/**
 * The on-demand network check — what each machine-and-printer pair reports.
 *
 * The fold is tested with injected probes, so it never touches the network.
 * `tcpReachable` and `icmpPing` get loopback tests only: a closed local port
 * refuses at once, so neither waits on a timeout.
 *
 *   bun test ./src/netcheck.test.ts
 */

import { describe, expect, test } from "bun:test";

import {
  checkTarget,
  icmpPing,
  tcpReachable,
  type CheckStatus,
  type NetProbes,
} from "./netcheck";

/** Probes that answer from fixed sets. Unknown hosts fail. */
function probesWith(opts: {
  pingOk?: string[];
  pingUnavailable?: boolean;
  /** Open sockets as `ip:port`. */
  open?: string[];
}): NetProbes & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    ping: async (ip): Promise<CheckStatus> => {
      calls.push(`ping ${ip}`);
      if (opts.pingUnavailable) return "unavailable";
      return opts.pingOk?.includes(ip) ? "ok" : "fail";
    },
    tcp: async (ip, port) => {
      calls.push(`tcp ${ip}:${port}`);
      return opts.open?.includes(`${ip}:${port}`) ?? false;
    },
  };
}

describe("checkTarget", () => {
  test("a healthy machine and printer report ok on every check", async () => {
    const probes = probesWith({
      pingOk: ["10.0.0.1", "10.0.0.2"],
      open: ["10.0.0.1:80", "10.0.0.1:4370", "10.0.0.2:9100"],
    });
    const result = await checkTarget(
      { ip: "10.0.0.1", port: 80, printer: { ip: "10.0.0.2", port: 9100 } },
      probes
    );
    expect(result).toEqual({
      finger: { ip: "10.0.0.1", port: 80, ping: "ok", web: "ok", zk: "ok" },
      printer: { ip: "10.0.0.2", port: 9100, ping: "ok", raw: "ok" },
    });
  });

  test("checks the machine's own SOAP port and the printer's own port", async () => {
    const probes = probesWith({});
    await checkTarget(
      { ip: "10.0.0.1", port: 8080, printer: { ip: "10.0.0.2", port: 9101 } },
      probes
    );
    expect(probes.calls).toContain("tcp 10.0.0.1:8080");
    expect(probes.calls).toContain("tcp 10.0.0.1:4370");
    expect(probes.calls).toContain("tcp 10.0.0.2:9101");
  });

  test("a machine that drops ICMP but answers 4370 is reported check by check", async () => {
    const probes = probesWith({ open: ["10.0.0.1:4370"] });
    const result = await checkTarget(
      { ip: "10.0.0.1", port: 80, printer: null },
      probes
    );
    expect(result.finger).toEqual({
      ip: "10.0.0.1",
      port: 80,
      ping: "fail",
      web: "fail",
      zk: "ok",
    });
  });

  test("an unpaired machine checks no printer", async () => {
    const probes = probesWith({});
    const result = await checkTarget(
      { ip: "10.0.0.1", port: 80, printer: null },
      probes
    );
    expect(result.printer).toBeNull();
    expect(probes.calls.every((c) => c.includes("10.0.0.1"))).toBe(true);
  });

  test("a missing ping binary reads as unavailable, not as a failure", async () => {
    const probes = probesWith({ pingUnavailable: true });
    const result = await checkTarget(
      { ip: "10.0.0.1", port: 80, printer: { ip: "10.0.0.2", port: 9100 } },
      probes
    );
    expect(result.finger.ping).toBe("unavailable");
    expect(result.printer?.ping).toBe("unavailable");
  });
});

describe("real probes on loopback", () => {
  test("tcpReachable is false on a closed port and answers quickly", async () => {
    const started = Date.now();
    // Port 1 (tcpmux) is closed on any ordinary host; loopback refuses at once.
    expect(await tcpReachable("127.0.0.1", 1, 2000)).toBe(false);
    expect(Date.now() - started).toBeLessThan(1500);
  });

  test("tcpReachable is true on a listening port", async () => {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port: 0,
      socket: { data() {} },
    });
    try {
      expect(await tcpReachable("127.0.0.1", server.port, 2000)).toBe(true);
    } finally {
      server.stop(true);
    }
  });

  test("icmpPing never throws and returns a known status", async () => {
    const status = await icmpPing("127.0.0.1");
    expect(["ok", "fail", "unavailable"]).toContain(status);
  });
});
