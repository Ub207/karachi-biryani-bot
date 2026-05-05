import { NextRequest, NextResponse } from "next/server";
import { sendWhatsAppMessage, markAsRead } from "@/lib/whatsapp";
import { getAIResponse } from "@/lib/agent";
import { menu } from "@/lib/menu-data";

/**
 * 🔐 VERIFY WEBHOOK
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;

  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  if (mode === "subscribe" && token === process.env.WHATSAPP_VERIFY_TOKEN) {
    return new NextResponse(challenge || "", { status: 200 });
  }

  return new NextResponse("Verification failed", { status: 403 });
}

/**
 * 📋 MENU TEXT
 */
function getMenuText(): string {
  return Object.entries(menu)
    .map(([name, price]) => `${name} - Rs ${price}`)
    .join("\n");
}

/**
 * 🛑 BASIC VALIDATION (ANTI-HALLUCINATION)
 */
function validateOrder(text: string): boolean {
  const lower = text.toLowerCase();

  return Object.keys(menu).some((item) =>
    lower.includes(item.toLowerCase())
  );
}

/**
 * ⚡ SIMPLE DEDUP
 */
const processedMessages = new Set<string>();

function isDuplicateMessage(messageId: string): boolean {
  if (processedMessages.has(messageId)) return true;

  processedMessages.add(messageId);

  if (processedMessages.size > 1000) {
    const recent = Array.from(processedMessages).slice(-500);
    processedMessages.clear();
    recent.forEach((id) => processedMessages.add(id));
  }

  return false;
}

/**
 * 📩 HANDLE WEBHOOK
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    const value = body.entry?.[0]?.changes?.[0]?.value;

    // Ignore delivery/read updates
    if (value?.statuses) {
      return NextResponse.json({ status: "ok" });
    }

    const message = value?.messages?.[0];

    if (!message?.from || !message?.id) {
      return NextResponse.json({ status: "ok" });
    }

    const from = message.from;
    const messageId = message.id;
    const type = message.type;

    let userText = "";

    // TEXT
    if (type === "text") {
      userText = message.text?.body?.trim() || "";
    }

    // BUTTON / LIST
    else if (type === "interactive") {
      userText =
        message.interactive?.button_reply?.title ||
        message.interactive?.list_reply?.title ||
        "";
    }

    // OTHER TYPES
    else {
      await sendWhatsAppMessage(
        from,
        "Sirf text messages supported hain. Meherbani karke text bhejein."
      );
      return NextResponse.json({ status: "ok" });
    }

    if (!userText) {
      return NextResponse.json({ status: "ok" });
    }

    // 🛑 DUPLICATE CHECK
    if (isDuplicateMessage(messageId)) {
      return NextResponse.json({ status: "ok" });
    }

    await markAsRead(messageId);

    const lower = userText.toLowerCase();

    // 📋 MENU COMMAND
    if (lower === "menu") {
      await sendWhatsAppMessage(from, getMenuText());
      return NextResponse.json({ status: "ok" });
    }

    // 🛑 BASIC VALIDATION (ANTI-HALLUCINATION FILTER)
    if (!validateOrder(userText)) {
      await sendWhatsAppMessage(
        from,
        "Menu se item select karein. 'menu' likhein dekhne ke liye."
      );
      return NextResponse.json({ status: "ok" });
    }

    console.log(`User (${from}): ${userText}`);

    // 🤖 AI RESPONSE
    const aiReply = await getAIResponse(from, userText);

    await sendWhatsAppMessage(from, aiReply);

    return NextResponse.json({ status: "ok" });
  } catch (error) {
    console.error("Webhook error:", error);

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}