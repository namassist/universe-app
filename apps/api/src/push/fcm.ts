/**
 * Pushes to Android phones through Firebase Cloud Messaging, HTTP v1
 * (docs/prd.md, Mobile app → Notifications on the phone).
 *
 * No SDK. The whole protocol is two requests: a JWT signed with the service
 * account's key, traded at Google's token endpoint for an hour's access
 * token, then one POST per message. WebCrypto signs the JWT, so this needs
 * no dependency, and the access token is cached until shortly before it
 * expires.
 *
 * Off until configured: with no `FCM_SERVICE_ACCOUNT_FILE`, `pushSender()` is
 * null, nothing is sent and nothing is marked sent, and the app's own list
 * still shows every notification. The file is the JSON key Firebase hands
 * out (Project settings → Service accounts); it is a credential and lives on
 * the server, never in the repository.
 */

import type { PushOutcome, PushSender } from "../person-notify";

export type ServiceAccount = {
  project_id: string;
  client_email: string;
  private_key: string;
};

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const SCOPE = "https://www.googleapis.com/auth/firebase.messaging";
const ASSERTION_SECONDS = 3600;
/** Renewed this long before Google says it expires, so a send never races it. */
const RENEW_EARLY_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

const base64url = (bytes: Uint8Array | string) =>
  Buffer.from(bytes).toString("base64url");

async function importKey(pem: string): Promise<CryptoKey> {
  const der = Buffer.from(
    pem.replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""),
    "base64"
  );
  return crypto.subtle.importKey(
    "pkcs8",
    der,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
}

/** The JWT Google trades for an access token. */
export async function signedAssertion(
  account: ServiceAccount,
  now: Date
): Promise<string> {
  const iat = Math.floor(now.getTime() / 1000);
  const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = base64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: TOKEN_URL,
      iat,
      exp: iat + ASSERTION_SECONDS,
    })
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    await importKey(account.private_key),
    new TextEncoder().encode(`${header}.${claims}`)
  );
  return `${header}.${claims}.${base64url(new Uint8Array(signature))}`;
}

/**
 * What FCM's answer means for the token. Only `UNREGISTERED` drops it: the
 * app was uninstalled or the token rotated. Everything else, a quota, an
 * outage, a malformed payload, keeps the token, because none of those is
 * the phone's fault.
 */
export function classify(status: number, body: unknown): PushOutcome {
  if (status >= 200 && status < 300) return "sent";
  const details =
    (body as { error?: { details?: { errorCode?: string }[] } })?.error
      ?.details ?? [];
  if (details.some((d) => d.errorCode === "UNREGISTERED"))
    return "unregistered";
  return "failed";
}

export function fcmSender(
  account: ServiceAccount,
  fetchImpl: typeof fetch = fetch
): PushSender {
  let cached: { token: string; until: number } | null = null;
  /* One exchange in flight at a time: ten parallel sends on a cold start
     would otherwise each trade their own assertion. */
  let pending: Promise<string | null> | null = null;

  function accessToken(): Promise<string | null> {
    if (cached && cached.until > Date.now())
      return Promise.resolve(cached.token);
    pending ??= exchange().finally(() => {
      pending = null;
    });
    return pending;
  }

  async function exchange(): Promise<string | null> {
    const now = Date.now();
    const res = await fetchImpl(TOKEN_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: await signedAssertion(account, new Date(now)),
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!res.ok) {
      console.error(`[push] token exchange refused (${res.status})`);
      return null;
    }
    const body = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };
    if (!body.access_token) return null;
    cached = {
      token: body.access_token,
      until:
        now + (body.expires_in ?? ASSERTION_SECONDS) * 1000 - RENEW_EARLY_MS,
    };
    return cached.token;
  }

  return {
    async send(token, message) {
      try {
        const bearer = await accessToken();
        if (!bearer) return "failed";
        const res = await fetchImpl(
          `https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`,
          {
            method: "POST",
            headers: {
              authorization: `Bearer ${bearer}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              message: {
                token,
                notification: { title: message.title, body: message.body },
                data: message.data,
                // Heard on a phone in doze, as a muster notice must be.
                android: { priority: "HIGH" },
              },
            }),
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          }
        );
        const body = await res.json().catch(() => ({}));
        const outcome = classify(res.status, body);
        if (outcome === "failed")
          console.warn(`[push] FCM refused a message (${res.status})`);
        return outcome;
      } catch (error) {
        // Logged without the token: it is a credential for this phone.
        console.warn("[push] FCM unreachable", (error as Error).message);
        return "failed";
      }
    },
  };
}

let configured: PushSender | undefined;

/**
 * The installation's sender, read once from `FCM_SERVICE_ACCOUNT_FILE`.
 * Null when it is unset; null, and said so in the log, when the file cannot
 * be read as a service account, so a bad key turns pushes off rather than
 * taking the API down with it.
 */
export async function pushSender(): Promise<PushSender> {
  if (configured !== undefined) return configured;
  const path = process.env.FCM_SERVICE_ACCOUNT_FILE?.trim();
  if (!path) return (configured = null);
  try {
    const account = (await Bun.file(path).json()) as Partial<ServiceAccount>;
    if (!account.project_id || !account.client_email || !account.private_key)
      throw new Error("missing project_id, client_email or private_key");
    return (configured = fcmSender(account as ServiceAccount));
  } catch (error) {
    console.error(
      `[push] FCM_SERVICE_ACCOUNT_FILE is not a usable service account: ${(error as Error).message}`
    );
    return (configured = null);
  }
}
