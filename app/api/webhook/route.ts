// app/api/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage, markAsRead } from "@/lib/whatsapp";
import { getAIResponse } from "@/lib/ai-agent";

// GET: Webhook verification (Meta calls this once)
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    console.log("Webhook verified!");
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Verification failed", { status: 403 });
}

// POST: Receive incoming messages from WhatsApp
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    console.log("Webhook received:", JSON.stringify(body, null, 2));

    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;
    const messages = value?.messages;

    if (!messages || messages.length === 0) {
      return NextResponse.json({ status: "ok" });
    }

    const message = messages[0];
    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;

    let userText = "";
    if (messageType === "text") {
      userText = message.text.body;
    } else {
      await sendWhatsAppMessage(from, "Maaf kijiye, sirf text messages handle karta hoon abhi.");
      return NextResponse.json({ status: "ok" });
    }

    await markAsRead(messageId);
    const aiReply = await getAIResponse(from, userText);
    await sendWhatsAppMessage(from, aiReply);

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}