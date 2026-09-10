import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

const appSecret = "test-app-secret";
const body = "{}";

function signedRequest(signature?: string) {
  return new NextRequest("http://localhost/api/webhook", {
    method: "POST",
    headers: signature ? { "x-hub-signature-256": signature } : {},
    body,
  });
}

async function withAppSecret<T>(secret: string | undefined, run: () => Promise<T>) {
  const previous = process.env.WHATSAPP_APP_SECRET;
  if (secret === undefined) {
    delete process.env.WHATSAPP_APP_SECRET;
  } else {
    process.env.WHATSAPP_APP_SECRET = secret;
  }

  try {
    return await run();
  } finally {
    if (previous === undefined) {
      delete process.env.WHATSAPP_APP_SECRET;
    } else {
      process.env.WHATSAPP_APP_SECRET = previous;
    }
  }
}

test("webhook POST requires a configured app secret and valid Meta signature", async () => {
  const validSignature = `sha256=${createHmac("sha256", appSecret).update(body).digest("hex")}`;

  await withAppSecret(undefined, async () => {
    assert.equal((await POST(signedRequest(validSignature))).status, 401);
  });

  await withAppSecret(appSecret, async () => {
    assert.equal((await POST(signedRequest())).status, 401);
    assert.equal((await POST(signedRequest("not-a-meta-signature"))).status, 401);
    assert.equal((await POST(signedRequest("sha256=deadbeef"))).status, 401);
    assert.equal((await POST(signedRequest(validSignature))).status, 200);
  });
});
