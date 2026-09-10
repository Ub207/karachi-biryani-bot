import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { GET, POST } from "./route";

const appSecret = "test-app-secret";
const verifyToken = "test-verify-token";
const body = "{}";

function signedRequest(signature?: string) {
  return new NextRequest("http://localhost/api/webhook", {
    method: "POST",
    headers: signature ? { "x-hub-signature-256": signature } : {},
    body,
  });
}

function verificationRequest(params: { mode?: string; token?: string; challenge?: string } = {}) {
  const url = new URL("http://localhost/api/webhook");
  if (params.mode !== undefined) url.searchParams.set("hub.mode", params.mode);
  if (params.token !== undefined) url.searchParams.set("hub.verify_token", params.token);
  if (params.challenge !== undefined) url.searchParams.set("hub.challenge", params.challenge);
  return new NextRequest(url.toString(), { method: "GET" });
}

async function withEnv<T>(
  env: { secret?: string; verifyToken?: string },
  run: () => Promise<T>
) {
  const prevSecret = process.env.WHATSAPP_APP_SECRET;
  const prevVerifyToken = process.env.WHATSAPP_VERIFY_TOKEN;

  if (env.secret === undefined) {
    delete process.env.WHATSAPP_APP_SECRET;
  } else {
    process.env.WHATSAPP_APP_SECRET = env.secret;
  }

  if (env.verifyToken === undefined) {
    delete process.env.WHATSAPP_VERIFY_TOKEN;
  } else {
    process.env.WHATSAPP_VERIFY_TOKEN = env.verifyToken;
  }

  try {
    return await run();
  } finally {
    if (prevSecret === undefined) {
      delete process.env.WHATSAPP_APP_SECRET;
    } else {
      process.env.WHATSAPP_APP_SECRET = prevSecret;
    }

    if (prevVerifyToken === undefined) {
      delete process.env.WHATSAPP_VERIFY_TOKEN;
    } else {
      process.env.WHATSAPP_VERIFY_TOKEN = prevVerifyToken;
    }
  }
}

test("webhook GET verification handles token validation", async () => {
  const validParams = { mode: "subscribe", token: verifyToken, challenge: "12345" };

  // Fails if VERIFY_TOKEN is missing
  await withEnv({ secret: appSecret, verifyToken: undefined }, async () => {
    const res = await GET(verificationRequest(validParams));
    assert.equal(res.status, 403);
  });

  // Fails if token does not match
  await withEnv({ secret: appSecret, verifyToken }, async () => {
    const res = await GET(verificationRequest({ ...validParams, token: "wrong-token" }));
    assert.equal(res.status, 403);
  });

  // Fails if mode is not subscribe
  await withEnv({ secret: appSecret, verifyToken }, async () => {
    const res = await GET(verificationRequest({ ...validParams, mode: "other" }));
    assert.equal(res.status, 403);
  });

  // Succeeds when token and mode match
  await withEnv({ secret: appSecret, verifyToken }, async () => {
    const res = await GET(verificationRequest(validParams));
    assert.equal(res.status, 200);
    assert.equal(await res.text(), "12345");
  });
});

test("webhook POST verifies signatures when app secret is set and allows requests when unset", async () => {
  const validSignature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;

  // When WHATSAPP_APP_SECRET is not configured, allows request to prevent live bot outage
  await withEnv({ secret: undefined, verifyToken }, async () => {
    assert.equal((await POST(signedRequest())).status, 200);
  });

  // When WHATSAPP_APP_SECRET is configured, strictly requires valid HMAC signature
  await withEnv({ secret: appSecret, verifyToken }, async () => {
    assert.equal((await POST(signedRequest())).status, 401);
    assert.equal((await POST(signedRequest("not-a-meta-signature"))).status, 401);
    assert.equal((await POST(signedRequest("sha256=deadbeef"))).status, 401);
    assert.equal((await POST(signedRequest(validSignature))).status, 200);
  });
});

test("GET /api/health returns system status", async () => {
  const { GET: healthGET } = await import("../health/route");
  const res = await healthGET();
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.ok(["ok", "degraded"].includes(data.status));
  assert.ok(data.services.webhook);
  assert.ok(data.services.redis);
  assert.ok(data.services.ai);
  assert.ok(data.services.whatsapp);
});
