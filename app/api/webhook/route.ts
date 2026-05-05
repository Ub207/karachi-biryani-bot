// app/api/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage, markAsRead } from "@/lib/whatsapp";
import { getAIResponse } from "@/lib/agent";

// Deduplicate processed messages
const processedMessages = new Set<string>();

function isDuplicateMessage(messageId: string): boolean {
  if (processedMessages.has(messageId)) return true;
  processedMessages.add(messageId);
  
  // Cleanup: keep only last 1000 IDs
  if (processedMessages.size > 1000) {
    const arr = Array.from(processedMessages);
    processedMessages.clear();
    arr.slice(-500).forEach(id => processedMessages.add(id));
  }
  return false;
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
  try {
    const body = await request.json();
    
    const entry = body.entry?.[0];
    const changes = entry?.changes?.[0];
    const value = changes?.value;

    // 🛑 Filter 1: Ignore status updates (delivered, read receipts)
    if (value?.statuses) {
      console.log("Ignoring status update");
      return NextResponse.json({ status: "ok" });
    }

    // 🛑 Filter 2: No messages = nothing to do
    const messages = value?.messages;
    if (!messages || messages.length === 0) {
      return NextResponse.json({ status: "ok" });
    }

    const message = messages[0];
    
    // 🛑 Filter 3: Must have valid from + id
    if (!message.from || !message.id) {
      return NextResponse.json({ status: "ok" });
    }

    // 🛑 Filter 4: Deduplicate
    if (isDuplicateMessage(message.id)) {
      console.log("Duplicate message, skipping:", message.id);
      return NextResponse.json({ status: "ok" });
    }

    const from = message.from;
    const messageId = message.id;
    const messageType = message.type;

    // 🛑 Filter 5: Extract text from message types
    let userText = "";
    
    if (messageType === "text" && message.text?.body) {
      userText = message.text.body.trim();
    } else if (messageType === "interactive") {
      userText = message.interactive?.button_reply?.title || 
                 message.interactive?.list_reply?.title || "";
      userText = userText.trim();
    } else {
      // Image, audio, video, sticker, document
      await sendWhatsAppMessage(
        from,
        "Maaf kijiye, abhi sirf text messages handle karta hoon. Apna message text mein bhejein."
      );
      return NextResponse.json({ status: "ok" });
    }

    // 🛑 Filter 6: Empty messages
    if (!userText) {
      return NextResponse.json({ status: "ok" });
    }

    console.log(`📩 Message from ${from}: ${userText}`);

    // Mark as read
    await markAsRead(messageId);

    // Get AI response
    const aiReply = await getAIResponse(from, userText);

    // Send reply
    await sendWhatsAppMessage(from, aiReply);

    console.log(`📤 Replied to ${from}`);
    return NextResponse.json({ status: "ok" });

  } catch (error) {
    console.error("❌ Webhook error:", error);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}