/**
 * Bulk employee-photo upload (design D8), for a folder of portraits.
 *
 * The web form uploads one photo at a time because that is how an operator
 * corrects one person. A new site arrives with a thousand of them at once, and
 * the sensible answer is not a second upload endpoint but a second client for
 * the one that exists: this script logs in once with `transport: "bearer"` —
 * cookies are for browsers — and then POSTs each file exactly as the form does,
 * so every rule the endpoint enforces (scope, size, accepted image types, the
 * generated filename) applies here unchanged.
 *
 * A file is matched to a person by its own name: `504264267.jpg` is that NIK's
 * photo. Nothing else is read from the name — no ordering, no manifest — which
 * makes the folder its own instruction and a mistake in it visible before the
 * upload rather than after.
 *
 * Usage:
 *   API_URL=http://192.168.151.23:8081 \
 *   API_IDENTIFIER=superadmin API_PASSWORD=... \
 *   bun run photos:upload -- ./foto [--dry-run] [--concurrency 4]
 *
 * Credentials come from the environment, never from an argument: a password on
 * the command line lands in the shell history and in `ps` for every other user
 * on the box.
 */

import { readdir } from "node:fs/promises";
import { basename, extname, join } from "node:path";

/** The four the API stores; anything else it refuses, so refuse it here. */
const ACCEPTED = new Set([".jpg", ".jpeg", ".png", ".webp"]);

/** Mirrors MAX_PHOTO_BYTES, so an oversized file fails before the round trip. */
const MAX_BYTES = 5 * 1024 * 1024;

/** Enough to keep the API busy, few enough not to starve it of connections. */
const DEFAULT_CONCURRENCY = 4;

type Outcome = { nik: string; ok: boolean; detail: string };

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Environment variable ${name} is required.`);
    process.exit(1);
  }
  return value;
}

async function login(base: string): Promise<string> {
  const response = await fetch(`${base}/v1/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      identifier: required("API_IDENTIFIER"),
      password: required("API_PASSWORD"),
      transport: "bearer",
    }),
  });
  if (!response.ok) {
    console.error(`Login failed: ${response.status} ${await response.text()}`);
    process.exit(1);
  }
  const { sessionId } = (await response.json()) as { sessionId?: string };
  if (!sessionId) {
    console.error("Login succeeded but returned no sessionId.");
    process.exit(1);
  }
  return sessionId;
}

async function uploadOne(
  base: string,
  token: string,
  dir: string,
  fileName: string
): Promise<Outcome> {
  const nik = basename(fileName, extname(fileName));
  const file = Bun.file(join(dir, fileName));
  if (file.size > MAX_BYTES)
    return { nik, ok: false, detail: `terlalu besar (${file.size} B)` };

  const form = new FormData();
  form.append("file", file, fileName);
  const response = await fetch(
    `${base}/v1/employees/${encodeURIComponent(nik)}/photo`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    }
  );
  if (response.ok) return { nik, ok: true, detail: fileName };

  // The API answers with a message meant for a person; pass it through rather
  // than translating a status code into a worse sentence.
  const body = (await response.json().catch(() => null)) as {
    message?: string;
  } | null;
  return {
    nik,
    ok: false,
    detail: body?.message ?? `HTTP ${response.status}`,
  };
}

/** Runs `worker` over `items`, `limit` in flight, preserving nothing but order
 *  of completion — the summary is sorted, so arrival order does not matter. */
async function pooled<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const item = items[next++]!;
        results.push(await worker(item));
      }
    })
  );
  return results;
}

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir || dir.startsWith("--")) {
    console.error("Usage: bun run photos:upload -- <folder> [--dry-run]");
    process.exit(1);
  }

  const base = (process.env.API_URL ?? "http://localhost:3001").replace(
    /\/+$/,
    ""
  );
  const dryRun = process.argv.includes("--dry-run");
  const concurrency = Number(flag("concurrency") ?? DEFAULT_CONCURRENCY);

  const entries = await readdir(dir);
  const photos = entries.filter((f) => ACCEPTED.has(extname(f).toLowerCase()));
  const skipped = entries.filter((f) => !photos.includes(f));

  console.log(`${photos.length} foto di ${dir}, tujuan ${base}`);
  if (skipped.length)
    console.log(`  dilewati (bukan gambar): ${skipped.join(", ")}`);
  if (!photos.length) return;

  if (dryRun) {
    for (const f of photos) console.log(`  ${basename(f, extname(f))}  ← ${f}`);
    console.log("--dry-run: tidak ada yang dikirim.");
    return;
  }

  const token = await login(base);
  const results = await pooled(photos, concurrency, (f) =>
    uploadOne(base, token, dir, f)
  );

  const failed = results
    .filter((r) => !r.ok)
    .sort((a, b) => a.nik.localeCompare(b.nik));
  console.log(`\nBerhasil ${results.length - failed.length}/${results.length}`);
  for (const f of failed) console.log(`  GAGAL ${f.nik}: ${f.detail}`);
  if (failed.length) process.exitCode = 1;
}

await main();
