/**
 * What a committed OpenAPI document says about each answer an operation can
 * give. Used by the integration document (`integrations/openapi.ts`).
 *
 * Elysia publishes the statuses a route declares, each described only as
 * "Response for status 401". Two answers come from the app around every
 * route and are never declared by one (`index.ts`, onError):
 *
 * - **422 `validation_failed`** when the path, query or body does not match
 *   the route's schema, with `issues` naming each field at fault. A route
 *   that refuses with 422 itself sends the same shape without `issues`.
 * - **500 `internal_error`** for anything unhandled; the detail is logged,
 *   never sent.
 *
 * So each operation gets both, every placeholder description is replaced by
 * what the status means, and the `code` values the operation can send are
 * named beside it. The codes are words in a description, not an `enum`: a
 * client must keep reading an answer whose code it does not know.
 */

type Json = Record<string, unknown>;

export type Operation = Json & {
  parameters?: unknown[];
  requestBody?: unknown;
  responses: Record<string, Json>;
};

/** The `code` values an operation's route can send, per status. */
export type Refusals = Partial<Record<string, readonly string[]>>;

export type ResponseWords = {
  /** What each status means here, used where Elysia wrote a placeholder. */
  status: Record<string, string>;
  /** "Codes: `a`, `b`." in the document's language. */
  codes: (codes: readonly string[]) => string;
  validation: string;
  internal: string;
  /** The success, from the operation's summary when it has one. */
  success: (summary: string | undefined) => string;
  /** The code an error example shows when the operation names none. */
  fallbackCode: Record<string, string>;
  /** The API's own message per code, for the error examples. */
  messages: Record<string, string>;
  /** One field at fault, as a validation failure here would name it. */
  validationIssue: { field: string; message: string };
};

/**
 * The API's own sentence per code, with its placeholders filled in as a
 * real answer would have them.
 */
const MESSAGES: Record<string, string> = {
  unauthenticated: "Sesi tidak valid",
  forbidden: "Akses ditolak",
  password_change_required: "Ganti password sebelum melanjutkan",
  validation_failed: "Request failed validation",
  internal_error: "Something went wrong",
  invalid_credentials: "Identifier atau password salah",
  first_login_on_site:
    "Login pertama harus dari jaringan site. Setelah password diganti, akun bisa dipakai dari mana saja.",
  too_many_attempts: "Terlalu banyak percobaan — coba lagi dalam 15 menit",
  password_too_short: "Password minimal 8 karakter",
  password_is_default: "Password baru tidak boleh sama dengan password awal",
  no_employee: "Akun ini tidak terhubung ke data karyawan",
  invalid_range: "Rentang tanggal terbalik atau lebih dari 62 hari",
  not_found: "Notifikasi tidak ditemukan",
  roster_document_not_found: "Dokumen roster tidak ditemukan",
  employee_not_found: "Kartu tidak dikenali",
  device_not_found: "Display fleet tersebut tidak ditemukan",
  board_not_found: "Papan untuk tanggal dan shift itu belum dibuat",
  unit_not_found: "Unit tidak ditemukan",
  slot_not_found: "Pasangan unit-operator tidak ditemukan",
  already_placed: "Operator itu sudah dipasang di unit DT4023",
  ftw_acknowledgement_required:
    "Operator ini tidak lolos fit-to-work untuk unit yang mensyaratkannya. Konfirmasi dulu kalau tetap mau ditempatkan.",
  user_not_found: "Akun tidak ditemukan",
  own_account:
    "Akun yang sedang dipakai tidak bisa direset. Minta admin lain, atau ganti password dari Profil.",
  last_roles_admin:
    "Akun ini satu-satunya yang masih bisa mengelola role — tidak bisa dinonaktifkan",
  identifier_required: "Akun harus punya email atau NIK",
  department_not_found: "Departemen tidak ditemukan",
  today_only: "Laporan ini hanya untuk hari ini",
  missing_date: "Tanggal wajib diisi",
  missing_shift: "Shift wajib diisi",
};

/** What a validation failure looks like, for its example. */
const validationExample = (words: ResponseWords) => ({
  code: "validation_failed",
  message: "Request failed validation",
  issues: [words.validationIssue],
});

const PLACEHOLDER = /^Response for status \d{3}$/;

const ERROR_SCHEMA = {
  type: "object",
  required: ["code", "message"],
  properties: { code: { type: "string" }, message: { type: "string" } },
};

const VALIDATION_SCHEMA = {
  type: "object",
  required: ["code", "message"],
  properties: {
    code: { type: "string" },
    message: { type: "string" },
    /** Present for `validation_failed`, absent for a route's own 422. */
    issues: {
      type: "array",
      items: {
        type: "object",
        required: ["field", "message"],
        properties: {
          field: { type: "string" },
          message: { type: "string" },
        },
      },
    },
  },
};

/**
 * The operation with every answer described. A `Refusals` entry for a status
 * the operation does not declare throws: a code documented on an answer that
 * cannot happen is the drift this exists to prevent.
 */
export function documentResponses(
  operation: Operation,
  words: ResponseWords,
  refusals: Refusals = {},
  /** The session gate's codes, per status, for an operation behind one. */
  gate: Refusals = {}
): Operation {
  const named = (status: string) => [
    ...(gate[status] ?? []),
    ...(refusals[status] ?? []),
  ];
  for (const status of Object.keys(refusals))
    if (status !== "422" && !(status in operation.responses))
      throw new Error(
        `documented ${status} that the operation does not declare`
      );

  /* The operation's own refusal is the more telling example; the gate's
     comes first only where the route adds none. */
  const exampleOf = (status: string) => {
    const code =
      refusals[status]?.[0] ?? gate[status]?.[0] ?? words.fallbackCode[status];
    return code
      ? { code, message: words.messages[code] ?? MESSAGES[code] ?? code }
      : undefined;
  };
  const withExample = (response: Json, example: unknown) => {
    const content = response.content as Record<string, Json> | undefined;
    const media = content?.["application/json"];
    return media && example !== undefined
      ? {
          ...response,
          content: { ...content, "application/json": { ...media, example } },
        }
      : response;
  };

  const responses: Record<string, Json> = {};
  for (const [status, response] of Object.entries(operation.responses)) {
    const placeholder = PLACEHOLDER.test(String(response.description ?? ""));
    const meaning = status.startsWith("2")
      ? words.success(operation.summary as string | undefined)
      : (words.status[status] ?? "");
    const codes = named(status);
    const described = {
      ...response,
      description: placeholder
        ? [meaning, codes.length ? words.codes(codes) : ""]
            .filter(Boolean)
            .join(" ")
        : response.description,
    };
    responses[status] = status.startsWith("2")
      ? described
      : withExample(described, exampleOf(status));
  }

  if (operation.parameters?.length || operation.requestBody) {
    const own = refusals["422"] ?? [];
    responses["422"] = {
      description: [
        words.validation,
        words.codes(["validation_failed", ...own]),
      ].join(" "),
      content: {
        "application/json": {
          schema: VALIDATION_SCHEMA,
          example: own.length ? exampleOf("422") : validationExample(words),
        },
      },
    };
  } else if (refusals["422"]?.length) {
    throw new Error("documented 422 on an operation that takes no input");
  }

  responses["500"] = {
    description: [words.internal, words.codes(["internal_error"])].join(" "),
    content: {
      "application/json": {
        schema: ERROR_SCHEMA,
        example: {
          code: "internal_error",
          message: words.messages.internal_error ?? MESSAGES.internal_error,
        },
      },
    },
  };

  return { ...operation, responses };
}

/** For the integration document, handed to other services' teams. */
export const INDONESIAN: ResponseWords = {
  status: {
    "304": "Tidak berubah sejak versi yang dikirim.",
    "401": "Token tidak bisa dipakai.",
    "403": "Token valid tetapi tidak boleh dipakai di sini.",
    "404": "Data tidak ditemukan.",
    "429": "Batas permintaan per menit sudah terlewati.",
  },
  codes: (codes) => `Kode: ${codes.map((c) => `\`${c}\``).join(", ")}.`,
  validation:
    "Parameter tidak sesuai aturan (misalnya `limit` lebih dari 500). `issues` menyebut setiap parameter yang salah.",
  internal:
    "Terjadi kesalahan di server. Detailnya dicatat di server, tidak dikirim. Coba lagi nanti.",
  success: (summary) => (summary ? `Berhasil: ${summary}.` : "Berhasil."),
  fallbackCode: {
    "401": "unauthenticated",
    "403": "forbidden",
    "404": "not_found",
    "429": "rate_limited",
  },
  messages: {
    unauthenticated: "Token integrasi tidak valid",
    forbidden: "Token ini tidak diberi akses ke data ini",
    not_found: "Karyawan tidak ditemukan",
    rate_limited: "Terlalu banyak permintaan — coba lagi sebentar",
    validation_failed: "Request failed validation",
    internal_error: "Something went wrong",
  },
  validationIssue: {
    field: "limit",
    message: "Expected number to be less or equal to 500",
  },
};
