import Groq from "groq-sdk";
import { menu } from "./menu-data";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

/**
 * ⚠️ In production replace Map with Redis
 */
const conversations = new Map<
  string,
  { role: "user" | "assistant"; content: string }[]
>();

/**
 * 🔥 INTENT CLASSIFIER ONLY (NO ANSWERS)
 */
const INTENT_PROMPT = `
You are an intent classifier for a restaurant WhatsApp bot.

Return ONLY valid JSON.

INTENTS:
- ORDER
- MENU
- PRICE_QUERY
- GREETING
- UNKNOWN

RULES:
- Do NOT respond to user
- Do NOT explain anything
- Output ONLY JSON
- Extract food items exactly as written if present

FORMAT:
{
  "intent": "ORDER",
  "items": [
    { "name": "chicken biryani", "qty": 1 }
  ]
}
`;

/**
 * 🧠 1. INTENT CLASSIFIER (LLM SAFE USE)
 */
async function classifyIntent(message: string) {
  const res = await groq.chat.completions.create({
    model: "llama-3.3-70b-versatile",
    temperature: 0.1,
    max_tokens: 200,
    messages: [
      { role: "system", content: INTENT_PROMPT },
      { role: "user", content: message },
    ],
  });

  try {
    return JSON.parse(res.choices[0]?.message?.content || "{}");
  } catch {
    return { intent: "UNKNOWN", items: [] };
  }
}

/**
 * 💰 PRICE ENGINE (NO AI ALLOWED)
 */
function calculateTotal(items: { name: string; qty: number }[]) {
  let total = 0;

  for (const item of items) {
    const key = Object.keys(menu).find(
      (k) => k.toLowerCase() === item.name.toLowerCase()
    );

    if (!key) {
      throw new Error("ITEM_NOT_FOUND");
    }

    total += menu[key] * (item.qty || 1);
  }

  return total;
}

/**
 * 🧾 RESPONSE TEMPLATES (NO LLM HERE)
 */
function formatOrder(items: any[], total: number) {
  const list = items
    .map((i) => `• ${i.name} x${i.qty}`)
    .join("\n");

  return `🧾 Aapka Order:\n${list}\n\n💰 Total: Rs. ${total}\n\nKya aap confirm karna chahte hain?`;
}

function getMenuText() {
  return Object.entries(menu)
    .map(([name, price]) => `• ${name} - Rs. ${price}`)
    .join("\n");
}

/**
 * 🧠 2. MAIN FUNCTION (SAFE ORCHESTRATION)
 */
export async function getAIResponse(
  userPhone: string,
  userMessage: string
): Promise<string> {
  let history = conversations.get(userPhone) || [];

  history.push({ role: "user", content: userMessage });

  if (history.length > 10) {
    history = history.slice(-10);
  }

  try {
    const intent = await classifyIntent(userMessage);

    let response = "";

    switch (intent.intent) {
      case "GREETING":
        response =
          "Assalam o Alaikum! 😊 Aap kya order karna pasand karenge?\n\n" +
          getMenuText();
        break;

      case "MENU":
        response = `📋 Menu:\n\n${getMenuText()}`;
        break;

      case "PRICE_QUERY":
      case "ORDER":
        try {
          const total = calculateTotal(intent.items || []);
          response = formatOrder(intent.items || [], total);
        } catch (err) {
          response =
            "❌ Yeh item available nahi hai. Yeh humara menu hai:\n\n" +
            getMenuText();
        }
        break;

      default:
        response =
          "Maaf kijiye, main samajh nahi saka. Aap menu dekhna chahte hain?";
    }

    history.push({ role: "assistant", content: response });
    conversations.set(userPhone, history);

    return response;
  } catch (error) {
    console.error("Agent error:", error);

    return "⚠️ Technical issue hai, please thori dair baad try karein.";
  }
}