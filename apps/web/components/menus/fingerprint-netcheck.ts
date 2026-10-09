/**
 * The network-check dialog's rules, kept out of the component so they test
 * without a DOM: what counts as a problem, the order rows are shown in, and
 * how many checks run at once.
 */

/** `unavailable` is "could not ask" (no `ping` on the server), never red. */
export type CheckStatus = "ok" | "fail" | "unavailable";

/** The shape `POST /v1/fingerprint-machines/:id/netcheck` answers with. */
export type NetcheckResult = {
  id: string;
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

export type NetcheckRow = {
  id: string;
  name: string;
  state: "pending" | "done" | "error";
  result?: NetcheckResult;
};

/**
 * A row is a problem when any check failed, or the request itself did. Ping
 * that could not run is not one — it says nothing about the machine.
 */
export function rowHasProblem(row: NetcheckRow): boolean {
  if (row.state === "error") return true;
  if (row.state !== "done" || !row.result) return false;
  const { finger, printer } = row.result;
  const checks: CheckStatus[] = [finger.ping, finger.web, finger.zk];
  if (printer) checks.push(printer.ping, printer.raw);
  return checks.includes("fail");
}

/** Problems first, then rows still being checked, then healthy; by name within. */
export function sortForDisplay(rows: readonly NetcheckRow[]): NetcheckRow[] {
  const rank = (r: NetcheckRow) =>
    rowHasProblem(r) ? 0 : r.state === "pending" ? 1 : 2;
  return [...rows].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      a.name.localeCompare(b.name, undefined, { numeric: true })
  );
}

export function summarise(rows: readonly NetcheckRow[]) {
  return {
    total: rows.length,
    finished: rows.filter((r) => r.state !== "pending").length,
    problems: rows.filter(rowHasProblem).length,
  };
}

/**
 * Run `fn` over `items` with at most `limit` in flight. The prober learned
 * that firing every connect at once pushes slow machines past their timeout,
 * so the dialog stays bounded too. `cancelled` is read before each item, so
 * closing the dialog stops new checks (those in flight finish on their own).
 */
export async function runPooled<T>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<void>,
  cancelled: () => boolean = () => false
): Promise<void> {
  let next = 0;
  const worker = async () => {
    while (!cancelled()) {
      const i = next++;
      if (i >= items.length) return;
      await fn(items[i]!);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker)
  );
}
