import Groq from "groq-sdk";
import { restaurantInfo, menu } from "./menu-data";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const conversations = new Map<
  string,
  { role: string; content: string }[]
>();

/**
 * 🔥 MENU TEXT (AI ko actual menu pata hoga ab)
 */
const menuText = Object.entries(menu)
  .map(([name, price]) => `${name} - Rs ${price}`)
  .join("\n");

/**
 * 🧠 SYSTEM PROMPT
 */
const SYSTEM_PROMPT = `
You are a STRICT order-taking assistant for ${restaurantInfo.name}.

MENU:
${menuText}

RULES:
- Only take orders from this menu
- No discounts
- No fake items
- If item not in menu → say "Item available nahi hai"
- Be short and polite
`;

export async function getAIResponse(
  userPhone: string,
  userMessage: string
): Promise<string> {
  let history = conversations.get(userPhone) || [];

  history.push({ role: "user", content: userMessage });

  if (history.length > 20) history = history.slice(-20);

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((m) => ({
          role: m.role as "user" | "assistant",
          content: m.content,
        })),
      ],
      temperature: 0.2,
      max_tokens: 250,
    });

    let reply =
      completion.choices[0]?.message?.content ||
      "Maaf kijiye, error ho gaya.";

    // 🔒 Basic safety fallback
    if (reply.length > 500) {
      reply = "Please apna order short aur clear likhein.";
    }

    history.push({ role: "assistant", content: reply });
    conversations.set(userPhone, history);

    return reply;
  } catch (err) {
    return "Technical issue hai, please dobara try karein.";
  }
}

/**
 * 💰 PRICING FUNCTION (TS SAFE)
 */
export function calculateTotal(
  items: { name: string; qty?: number }[]
): number {
  let total = 0;

  for (const item of items) {
    const key = item.name;

    const price = (menu as Record<string, number>)[key];

    if (price === undefined) {
      throw new Error(`Invalid menu item: ${key}`);
    }

    total += price * (item.qty || 1);
  }

  return total;
}