/**
 * What a committed OpenAPI document says about each answer an operation can
 * give. Shared by the integration document (`integrations/openapi.ts`) and the
 * mobile one (`mobile-openapi.ts`).
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
};

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

const json = (schema: Json) => ({ "application/json": { schema } });

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

  const responses: Record<string, Json> = {};
  for (const [status, response] of Object.entries(operation.responses)) {
    const placeholder = PLACEHOLDER.test(String(response.description ?? ""));
    const meaning = status.startsWith("2")
      ? words.success(operation.summary as string | undefined)
      : (words.status[status] ?? "");
    const codes = named(status);
    responses[status] = {
      ...response,
      description: placeholder
        ? [meaning, codes.length ? words.codes(codes) : ""]
            .filter(Boolean)
            .join(" ")
        : response.description,
    };
  }

  if (operation.parameters?.length || operation.requestBody) {
    const own = refusals["422"] ?? [];
    responses["422"] = {
      description: [
        words.validation,
        words.codes(["validation_failed", ...own]),
      ].join(" "),
      content: json(VALIDATION_SCHEMA),
    };
  } else if (refusals["422"]?.length) {
    throw new Error("documented 422 on an operation that takes no input");
  }

  responses["500"] = {
    description: [words.internal, words.codes(["internal_error"])].join(" "),
    content: json(ERROR_SCHEMA),
  };

  return { ...operation, responses };
}

/** For the mobile document, read by the app's developers. */
export const ENGLISH: ResponseWords = {
  status: {
    "304": "Not modified since the version sent.",
    "400": "The request could not be read.",
    "401": "No valid session: none was sent, or it has expired or ended.",
    "403": "Signed in, but this is not allowed.",
    "404": "Not found.",
    "409": "Refused: it conflicts with the current state.",
    "422": "Refused: the request is well formed but cannot be carried out.",
    "429": "Too many attempts. Wait for `Retry-After` seconds.",
  },
  codes: (codes) => `Codes: ${codes.map((c) => `\`${c}\``).join(", ")}.`,
  validation:
    "The request did not match the schema; `issues` names each field. Or the route refused the values.",
  internal:
    "Something failed on the server. The detail is logged, not sent; try again later.",
  success: (summary) => (summary ? `OK: ${summary}.` : "OK."),
};

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
};
