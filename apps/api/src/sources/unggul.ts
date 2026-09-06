/**
 * The roster source: unggul_att's `/attendance/data_roster`.
 *
 * The third external source, and the first reached over HTTP rather than SQL —
 * we are given an API and no database account. That is a constraint with one
 * quiet benefit: the read-only discipline the other two sources enforce with
 * `default_transaction_read_only` is here a property of the endpoint itself.
 *
 * **The response is wide, not long.** One object per person, carrying five
 * fixed fields and then one key per date in the requested range:
 *
 *     { "no_nik": "508242472", "nama_lengkap": "…", "departemen": "…",
 *       "posisi": "…", "tipe": "NON STAFF",
 *       "2026-09-01": "D", "2026-09-02": "OFF", … }
 *
 * Which is the shape of the roster spreadsheet, because it is the same grid.
 * Flattening it to one row per (person, day) happens here so that nothing
 * downstream has to know the source speaks in columns.
 *
 * `departemen` and `posisi` come back and are deliberately **ignored**. The two
 * systems do not spell departments the same way — "PIT SERVICE & DEVELOPMENT"
 * here is "PIT SERVICE AND DEVELOPMENT" in our register, "MAINTENANCE" is
 * "PLANT AND MAINTENANCE" — and reconciling those names would be a second
 * mapping table to keep true. Our own register already answers which department
 * a person is in, and it is the answer allocation reads, so it is the only one
 * that can be right here.
 *
 * Codes are returned raw. Most are ours (the legend was taken from this
 * system), but not all: a September pull carried `DS1`, `DS2`, `NS1`, `NS2`,
 * `KSG` and `0`, none of them in `ROSTER_CODES`. None touched an employee we
 * hold today — they sit in departments we do not mirror — but every one of them
 * was on an *operator*. Classifying them here would be guessing at a meaning
 * only unggul_att knows, so they travel out intact and the ingest counts them.
 *
 * Authentication is two-layered: a standing `sc` key on every request, which
 * buys a JWT good for one hour. The token is fetched per pull and never
 * stored — an hour's credential written to disk is a credential that spends
 * most of its life invalid.
 */

import { env } from "../env";

/** One code, one person, one day — the shape the wide response is folded into. */
export type RosterSourceRow = {
  /** Raw source NIK — normalize before joining. */
  nik: string | null;
  /** "YYYY-MM-DD", straight from the response key. */
  date: string;
  /** Raw source code, unvalidated — see above. */
  code: string;
};

export type RosterFetcher = (
  from: string,
  to: string
) => Promise<RosterSourceRow[]>;

/**
 * The five fields that are not dates.
 *
 * Named rather than pattern-matched: "everything that is not one of these is a
 * day column" fails open if the source adds a sixth field, and failing open
 * here means a stray field arriving as a roster code.
 */
const FIXED_FIELDS = new Set([
  "no_nik",
  "nama_lengkap",
  "departemen",
  "posisi",
  "tipe",
]);

/** A response key that is a date, which is what makes it a day column. */
const isDateKey = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(key);

/**
 * Long enough for a two-month pull, short enough that a hung source cannot
 * hold the scheduler's stage open until the window closes on its own.
 */
const TIMEOUT_MS = 30_000;

/**
 * One call to the source, with the standing key attached.
 *
 * `form` decides the method: the two endpoints differ only in whether they
 * carry one, and spelling that out twice was the version of this that drifted.
 */
async function call(
  path: string,
  options: { auth?: string; form?: URLSearchParams } = {}
): Promise<{ data?: unknown }> {
  const { auth, form } = options;
  const response = await fetch(`${env.ROSTER_SOURCE_URL}${path}`, {
    method: form ? "POST" : "GET",
    headers: {
      sc: env.ROSTER_SOURCE_SC,
      ...(auth ? { Authorization: auth } : {}),
      ...(form ? { "content-type": "application/x-www-form-urlencoded" } : {}),
    },
    body: form,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok)
    throw new Error(`roster source ${path}: HTTP ${response.status}`);
  return (await response.json()) as { data?: unknown };
}

/**
 * An hour-long JWT, sent back as a bare `Authorization` header.
 *
 * Bare: the source wants the token itself, not `Bearer <token>`.
 */
async function token(): Promise<string> {
  const body = await call("/attendance/getToken");
  if (typeof body.data !== "string" || !body.data)
    throw new Error("roster source returned no token");
  return body.data;
}

export const fetchRosterRows: RosterFetcher = async (from, to) => {
  const auth = await token();
  const body = await call("/attendance/data_roster", {
    auth,
    form: new URLSearchParams({ tglAwal: from, tglAkhir: to }),
  });
  // A range the source has nothing for answers with a message and no `data`,
  // which is an empty pull rather than a failure.
  if (!Array.isArray(body.data)) return [];

  const rows: RosterSourceRow[] = [];
  for (const person of body.data as Record<string, unknown>[]) {
    const nik = typeof person.no_nik === "string" ? person.no_nik : null;
    for (const [key, value] of Object.entries(person)) {
      if (FIXED_FIELDS.has(key) || !isDateKey(key)) continue;
      // An empty cell is a day the source says nothing about, which is not the
      // same as a day it says is unknown — only the latter is worth counting.
      if (typeof value !== "string" || value === "") continue;
      rows.push({ nik, date: key, code: value });
    }
  }
  return rows;
};
