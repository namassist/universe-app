/**
 * Firebase Cloud Messaging, HTTP v1, with no SDK: a service account signs a
 * JWT, Google trades it for an access token, and each push is one POST. The
 * network is never touched here: `fetch` is a fake, and the key is made for
 * the test.
 */

import { describe, expect, test } from "bun:test";

import {
  classify,
  fcmSender,
  signedAssertion,
  type ServiceAccount,
} from "./fcm";

async function testAccount(): Promise<{
  account: ServiceAccount;
  publicKey: CryptoKey;
}> {
  const pair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"]
  );
  const der = new Uint8Array(
    await crypto.subtle.exportKey("pkcs8", pair.privateKey)
  );
  const base64 = Buffer.from(der).toString("base64");
  const pem = `-----BEGIN PRIVATE KEY-----\n${base64.match(/.{1,64}/g)!.join("\n")}\n-----END PRIVATE KEY-----\n`;
  return {
    account: {
      project_id: "universe-uji",
      client_email: "push@universe-uji.iam.gserviceaccount.com",
      private_key: pem,
    },
    publicKey: pair.publicKey,
  };
}

const b64url = (s: string) => Buffer.from(s, "base64url");

describe("the signed assertion", () => {
  test("is an RS256 JWT for the messaging scope, signed by the account's key", async () => {
    const { account, publicKey } = await testAccount();
    const now = new Date("2026-10-17T05:26:00Z");
    const jwt = await signedAssertion(account, now);
    const [header, claims, signature] = jwt.split(".");

    expect(JSON.parse(b64url(header!).toString())).toEqual({
      alg: "RS256",
      typ: "JWT",
    });
    expect(JSON.parse(b64url(claims!).toString())).toEqual({
      iss: account.client_email,
      scope: "https://www.googleapis.com/auth/firebase.messaging",
      aud: "https://oauth2.googleapis.com/token",
      iat: now.getTime() / 1000,
      exp: now.getTime() / 1000 + 3600,
    });
    expect(
      await crypto.subtle.verify(
        "RSASSA-PKCS1-v1_5",
        publicKey,
        b64url(signature!),
        new TextEncoder().encode(`${header}.${claims}`)
      )
    ).toBe(true);
  });
});

describe("what a response means", () => {
  test("200 is sent", () => {
    expect(classify(200, {})).toBe("sent");
  });

  test("a token the app no longer holds is unregistered, so it is dropped", () => {
    expect(
      classify(404, {
        error: {
          status: "NOT_FOUND",
          details: [{ errorCode: "UNREGISTERED" }],
        },
      })
    ).toBe("unregistered");
  });

  test("anything else is a failure, and the token is kept", () => {
    expect(classify(500, {})).toBe("failed");
    expect(classify(429, { error: { status: "RESOURCE_EXHAUSTED" } })).toBe(
      "failed"
    );
    expect(classify(400, { error: { status: "INVALID_ARGUMENT" } })).toBe(
      "failed"
    );
  });
});

describe("the sender", () => {
  const message = {
    title: "Unit kamu: DT101",
    body: "Shift siang 18 Okt",
    data: { kind: "seat-assigned" },
  };

  function fakeFetch(answer: (url: string) => Response) {
    const calls: { url: string; init: RequestInit | undefined }[] = [];
    const impl = (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      return answer(url);
    }) as typeof fetch;
    return { impl, calls };
  }
  const tokenAnswer = () =>
    Response.json({ access_token: "ya29.uji", expires_in: 3600 });

  test("trades the assertion once and reuses the access token", async () => {
    const { account } = await testAccount();
    const { impl, calls } = fakeFetch((url) =>
      url.includes("oauth2") ? tokenAnswer() : Response.json({ name: "m/1" })
    );
    const sender = fcmSender(account, impl)!;
    expect(await sender.send("tok-1", message)).toBe("sent");
    expect(await sender.send("tok-2", message)).toBe("sent");

    expect(calls.filter((c) => c.url.includes("oauth2"))).toHaveLength(1);
    const pushes = calls.filter((c) => c.url.includes("fcm.googleapis.com"));
    expect(pushes.map((c) => c.url)).toEqual([
      "https://fcm.googleapis.com/v1/projects/universe-uji/messages:send",
      "https://fcm.googleapis.com/v1/projects/universe-uji/messages:send",
    ]);
    expect(
      (pushes[0]!.init!.headers as Record<string, string>).authorization
    ).toBe("Bearer ya29.uji");
    expect(JSON.parse(String(pushes[0]!.init!.body))).toEqual({
      message: {
        token: "tok-1",
        notification: { title: message.title, body: message.body },
        data: message.data,
        android: { priority: "HIGH" },
      },
    });
  });

  test("an unregistered token is reported as such", async () => {
    const { account } = await testAccount();
    const { impl } = fakeFetch((url) =>
      url.includes("oauth2")
        ? tokenAnswer()
        : Response.json(
            { error: { details: [{ errorCode: "UNREGISTERED" }] } },
            { status: 404 }
          )
    );
    expect(await fcmSender(account, impl)!.send("tok-old", message)).toBe(
      "unregistered"
    );
  });

  test("a network that will not answer is a failure, not a throw", async () => {
    const { account } = await testAccount();
    const impl = (async () => {
      throw new Error("ECONNRESET");
    }) as unknown as typeof fetch;
    expect(await fcmSender(account, impl)!.send("tok-1", message)).toBe(
      "failed"
    );
  });

  test("a refused token exchange is a failure too", async () => {
    const { account } = await testAccount();
    const { impl } = fakeFetch(
      () => new Response("invalid_grant", { status: 400 })
    );
    expect(await fcmSender(account, impl)!.send("tok-1", message)).toBe(
      "failed"
    );
  });
});
