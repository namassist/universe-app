/**
 * The OpenAPI document for the integration API — the one handed to other
 * services' teams (owner, 2026-10-09).
 *
 * Built from an app that mounts the integration routes and nothing else,
 * rather than by filtering `/openapi/json`: the full document describes every
 * internal route, and a filter that misses one leaks it. What is not mounted
 * cannot appear. The routes' own schemas are the source; this adds what the
 * generator cannot see — the image body and 304 of the photo route, the
 * `Retry-After` of a 429, the servers — and the result is committed to
 * `docs/` (`bun run openapi:integration`), with a test that fails when the
 * two drift apart.
 */

import { openapi } from "@elysiajs/openapi";
import { Elysia } from "elysia";
import { API_VERSION } from "@universe/contracts";

import { integrationRoutes } from "../routes/integrations";

/** Repo-relative, where the generated document is committed. */
export const INTEGRATION_SPEC_PATH =
  "docs/openapi/integration-api.openapi.json";

const DESCRIPTION = [
  "API ini dipakai layanan lain di jaringan site untuk membaca data karyawan",
  "Universe: NIK, nama, perusahaan, departemen, posisi, status, tanggal masuk,",
  "kode SIMPER, dan foto. Semua endpoint hanya untuk membaca.",
  "",
  "**Token.** Setiap permintaan wajib membawa header",
  "`Authorization: Bearer <token>`. Token dibuat oleh admin Universe di menu",
  "Integrasi API dan hanya ditampilkan sekali, jadi simpan baik-baik. Token",
  "berlaku dari tanggal mulai sampai tanggal akhir yang ditentukan admin",
  "(waktu site, WITA).",
  "",
  "**Batas pemakaian.** Satu token boleh mengirim 120 permintaan per menit.",
  "Kalau lebih, server membalas 429. Tunggu sesuai header `Retry-After`,",
  "lalu coba lagi.",
  "",
  '**Error.** Isi balasan error selalu `{ "code": "...", "message": "..." }`.',
  "Lihat bagian respons tiap endpoint untuk arti setiap `code`.",
].join("\n");

type Json = Record<string, unknown>;
type Operation = {
  parameters?: Json[];
  responses: Record<string, Json>;
};

/**
 * Per parameter: the words a reader needs, and — for the two integers — the
 * plain schema. Elysia publishes a coerced query integer as a string-or-integer
 * `anyOf` with a `default: 0` it never applies; a client generator would take
 * that at its word.
 */
const PARAMETERS: Record<string, Json> = {
  page: {
    description: "Halaman yang diminta. Halaman pertama adalah 1.",
    schema: { type: "integer", minimum: 1, maximum: 100_000, default: 1 },
  },
  limit: {
    description: "Jumlah karyawan per halaman, paling banyak 500.",
    schema: { type: "integer", minimum: 1, maximum: 500, default: 100 },
  },
  status: {
    description:
      "Tampilkan karyawan dengan status ini saja. Kalau tidak diisi, semua status ikut tampil.",
  },
  q: {
    description:
      "Cari dengan sebagian NIK atau nama. Huruf besar dan kecil dianggap sama, dan tanda `%` atau `_` dibaca apa adanya.",
  },
  nik: { description: "NIK karyawan yang dicari.", example: "12345678" },
};

const OPERATIONS: Record<
  string,
  { summary: string; description?: string; ok: string }
> = {
  "/v1/integrations/employees": {
    summary: "Ambil daftar karyawan",
    description:
      "Data dikirim per halaman dan diurutkan berdasarkan NIK. Untuk mengambil semuanya, lanjutkan ke halaman berikutnya sampai jumlah data yang terkumpul sama dengan `total`.",
    ok: "Daftar karyawan di halaman yang diminta.",
  },
  "/v1/integrations/employees/{nik}": {
    summary: "Ambil data satu karyawan",
    ok: "Data karyawan dengan NIK tersebut.",
  },
  "/v1/integrations/employees/{nik}/photo": {
    summary: "Ambil foto karyawan",
    description:
      "Simpan nilai `photo.version` dari data karyawan. Saat meminta foto lagi, kirim nilai itu di header `If-None-Match`. Kalau fotonya belum diganti, server membalas 304 tanpa mengirim ulang gambarnya.",
    ok: "File foto karyawan.",
  },
};

/** What a generated operation is missing, added in place. */
function complete(path: string, operation: Operation & Json): void {
  const words = OPERATIONS[path];
  if (words) {
    operation.summary = words.summary;
    if (words.description) operation.description = words.description;
    operation.responses["200"] = {
      ...operation.responses["200"],
      description: words.ok,
    };
  }
  operation.parameters = (operation.parameters ?? []).map((parameter) => {
    const extra = PARAMETERS[String(parameter.name)];
    return extra ? { ...parameter, ...extra } : parameter;
  });

  operation.responses["401"] = {
    ...operation.responses["401"],
    description:
      "Token tidak bisa dipakai. `unauthenticated`: token tidak dikirim, salah, atau sudah dicabut. `token_expired`: tanggal akhirnya sudah lewat. `token_not_yet_valid`: tanggal mulainya belum tiba.",
  };
  operation.responses["403"] = {
    ...operation.responses["403"],
    description:
      "Token valid tetapi tidak boleh dipakai di sini. `forbidden`: token tidak punya akses ke data ini. `ip_not_allowed`: permintaan datang dari IP yang tidak terdaftar untuk token ini.",
  };
  operation.responses["429"] = {
    ...operation.responses["429"],
    description: "Batas 120 permintaan per menit sudah terlewati.",
    headers: {
      "Retry-After": {
        description: "Berapa detik lagi boleh mencoba kembali.",
        schema: { type: "integer" },
      },
    },
  };

  if (!path.endsWith("/photo")) return;
  const image = { schema: { type: "string", format: "binary" } };
  operation.parameters = [
    ...(operation.parameters ?? []),
    {
      name: "If-None-Match",
      in: "header",
      required: false,
      description:
        "Isi dengan `photo.version` yang Anda simpan, diapit tanda kutip. Kalau fotonya belum berubah, server membalas 304 tanpa mengirim gambar.",
      schema: { type: "string", example: '"3f9a1c0b2d4e5f61"' },
    },
  ];
  operation.responses["200"] = {
    description: "File foto karyawan.",
    headers: {
      ETag: {
        description:
          "Versi foto ini, sama dengan `photo.version` di data karyawan.",
        schema: { type: "string" },
      },
    },
    content: {
      "image/jpeg": image,
      "image/png": image,
      "image/webp": image,
    },
  };
  operation.responses["304"] = {
    description: "Foto belum berubah sejak versi yang Anda kirim.",
  };
  operation.responses["404"] = {
    ...operation.responses["404"],
    description: "NIK tidak ditemukan, atau karyawan ini belum punya foto.",
  };
}

/**
 * The document says 3.0.3, but TypeBox writes two 3.1 forms into it: a
 * schema's `examples: [x]` (3.0 has `example: x`) and a nullable value as
 * `anyOf: [X, { type: "null" }]` (3.0 has `nullable: true` on X). Validators
 * and client generators reading 3.0 refuse both, so both are rewritten —
 * into a new tree, the generated one untouched.
 *
 * `additionalProperties` is dropped too. Elysia writes `false` into a route's
 * schemas when it first compiles their validators, so its presence depends on
 * whether the route has served a request yet; and a published "no extra
 * fields" would turn every field added later into a breaking change for a
 * strictly generated client.
 */
function as30(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(as30);
  if (!node || typeof node !== "object") return node;

  const { anyOf, examples, nullable, ...rest } = node as Json & {
    anyOf?: Json[];
    examples?: unknown;
    nullable?: boolean;
  };
  const out: Json = Object.fromEntries(
    Object.entries(rest)
      .filter(([key]) => key !== "additionalProperties")
      .map(([key, value]) => [key, as30(value)])
  );

  if (Array.isArray(examples) && examples.length) out.example = examples[0];
  else if (examples !== undefined) out.examples = as30(examples);

  if (Array.isArray(anyOf)) {
    const real = anyOf.filter((branch) => branch.type !== "null");
    if (real.length === 1 && real.length < anyOf.length)
      return { ...out, ...(as30(real[0]) as Json), nullable: true };
    out.anyOf = as30(anyOf);
  }
  if (nullable !== undefined) out.nullable = nullable;
  return out;
}

/** Responses in status order, so the committed file reads top to bottom. */
const sortedResponses = (responses: Record<string, Json>) =>
  Object.fromEntries(
    Object.entries(responses).sort(([a], [b]) => a.localeCompare(b))
  );

export async function buildIntegrationSpec(): Promise<Json> {
  const app = new Elysia()
    .use(
      openapi({
        documentation: {
          info: {
            title: "Universe Integration API",
            version: "1.0.0",
            description: DESCRIPTION,
          },
          servers: [
            { url: "http://192.168.151.23:8081", description: "Site" },
            { url: "http://localhost:3001", description: "Local" },
          ],
          tags: [
            {
              name: "integrations",
              description: "Data dan foto karyawan",
            },
          ],
          components: {
            securitySchemes: {
              integrationToken: {
                type: "http",
                scheme: "bearer",
                description: "Token dari menu Integrasi API di Universe",
              },
            },
          },
        },
      })
    )
    .use(new Elysia({ prefix: `/${API_VERSION}` }).use(integrationRoutes));

  const response = await app.handle(
    new Request("http://localhost/openapi/json")
  );
  const spec = (await response.json()) as Json & {
    paths: Record<string, Record<string, Operation>>;
  };

  for (const [path, methods] of Object.entries(spec.paths))
    for (const operation of Object.values(methods)) {
      complete(path, operation);
      operation.responses = sortedResponses(operation.responses);
    }
  return { ...spec, paths: as30(spec.paths) };
}
