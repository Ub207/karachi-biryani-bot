// app/api/webhook/route.ts
import { createHmac, timingSafeEqual } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage, markAsRead } from "@/lib/whatsapp";
import { getAIResponse } from "@/lib/agent";
import { getClientConfig } from "@/lib/client-config";
import { checkRateLimit } from "@/lib/rate-limit";

// Deduplicate processed messages
const processedMessages = new Set<string>();

function isDuplicateMessage(messageId: string): boolean {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);

  if (processedMessages.size > 1000) {
    const arr = Array.from(processedMessages);
    processedMessages.clear();
    arr.slice(-500).forEach((id) => processedMessages.add(id));
  }
  return false;
}

function verifySignature(rawBody: string, signature: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret) {
    // Secret not configured — allow but warn. Set WHATSAPP_APP_SECRET to enforce.
    console.warn("[webhook] WHATSAPP_APP_SECRET not set, skipping signature verification");
    return true;
  }
  if (!signature) {
    console.warn("[webhook] Missing X-Hub-Signature-256 header");
    return false;
  }
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false; // lengths differ
  }
}

// GET: Webhook verification
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("✅ Webhook verified!");
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Verification failed", { status: 403 });
}

// POST: Receive messages
export async function POST(request: NextRequest) {
  // Read raw body once — needed for both signature check and JSON parsing
  const rawBody = await request.text();

  if (!verifySignature(rawBody, request.headers.get("x-hub-signature-256"))) {
    console.warn("[webhook] Rejected request: invalid signature");
    return new NextResponse("Unauthorized", { status: 401 });
  }

  try {
    const body = JSON.parse(rawBody);

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // Filter 1: Ignore status updates (delivered, read receipts)
    if (value?.statuses) {
      return NextResponse.json({ status: "ok" });
    }

    // Filter 2: No messages = nothing to do
    const messages = value?.messages;
    if (!messages || messages.length === 0) {
      return NextResponse.json({ status: "ok" });
    }

    const message = messages[0];

    // Filter 3: Must have valid from + id
    if (!message.from || !message.id) {
      return NextResponse.json({ status: "ok" });
    }

    // Filter 4: Deduplicate
    if (isDuplicateMessage(message.id)) {
      console.log("Duplicate message, skipping:", message.id);
      return NextResponse.json({ status: "ok" });
    }

    // Identify which client this message belongs to
    const phoneNumberId: string =
      value?.metadata?.phone_number_id ?? process.env.WHATSAPP_PHONE_NUMBER_ID ?? "";
    if (!phoneNumberId) {
      console.error("No phone_number_id in webhook payload and no env fallback");
      return NextResponse.json({ status: "ok" });
    }

    const from: string = message.from;

    // Filter 5: Per-user rate limiting (20 messages/hour)
    const { allowed } = await checkRateLimit(phoneNumberId, from);
    if (!allowed) {
      console.warn(`[webhook] Rate limit exceeded for ${from} on client ${phoneNumberId}`);
      const config = await getClientConfig(phoneNumberId);
      await sendWhatsAppMessage(
        from,
        "Maaf kijiye, aap ne bahut zyada messages bheje hain. 1 ghante baad try karein. 🙏",
        config.whatsappToken,
        phoneNumberId
      );
      return NextResponse.json({ status: "ok" });
    }

    const config = await getClientConfig(phoneNumberId);

    const messageId: string = message.id;
    const messageType: string = message.type;

    // Filter 6: Extract text from message types
    let userText = "";

    if (messageType === "text" && message.text?.body) {
      userText = message.text.body.trim();
    } else if (messageType === "interactive") {
      userText =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "";
      userText = userText.trim();
    } else {
      await sendWhatsAppMessage(
        from,
        "Maaf kijiye, abhi sirf text messages handle karta hoon. Apna message text mein bhejein.",
        config.whatsappToken,
        phoneNumberId
      );
      return NextResponse.json({ status: "ok" });
    }

    // Filter 7: Empty messages
    if (!userText) {
      return NextResponse.json({ status: "ok" });
    }

    console.log("🚨 LIVE-WHATSAPP-PRODUCTION-PATH-2026", {
      rawText: userText,
      normalizedText: userText.trim().toLowerCase().replace(/\s+/g, " "),
      userId: from,
      phoneNumberId,
      rawMessage: JSON.stringify(message),
      length: userText.length,
      charCodes: [...userText].map(c => ({
        char: c,
        code: c.codePointAt(0)
      }))
    });

    console.log(`📩 [${phoneNumberId}] Message from ${from}: ${userText}`);

    await markAsRead(messageId, config.whatsappToken, phoneNumberId);

    const aiReply = await getAIResponse(phoneNumberId, from, userText, config);
    await sendWhatsAppMessage(from, aiReply, config.whatsappToken, phoneNumberId);

    console.log(`📤 [${phoneNumberId}] Replied to ${from}`);
    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("❌ Webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
