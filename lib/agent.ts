// lib/ai-agent.ts
import Groq from "groq-sdk";
import { restaurantInfo, getMenuText } from "./menu-data";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const conversations = new Map<string, { role: string; content: string }[]>();

const SYSTEM_PROMPT = `You are a friendly customer service agent for ${restaurantInfo.name}, a popular biryani restaurant in Karachi, Pakistan.

RESTAURANT INFO:
- Address: ${restaurantInfo.address}
- Hours: ${restaurantInfo.hours}
- Phone: ${restaurantInfo.phone}
- Delivery Areas: ${restaurantInfo.deliveryAreas.join(", ")}
- Minimum Order: Rs. ${restaurantInfo.minimumOrder}
- Delivery Fee: Rs. ${restaurantInfo.deliveryFee}
- Delivery Time: ${restaurantInfo.deliveryTime}

MENU:
${getMenuText()}

YOUR JOB:
1. Greet customers warmly in Roman Urdu/English mix
2. Help them choose from menu
3. Take orders (item, quantity, address, phone)
4. Answer questions about hours, location, delivery
5. Calculate total bill

RULES:
- Reply in same language customer uses (Urdu/Roman Urdu/English)
- Keep messages SHORT (under 100 words)
- Be warm and friendly
- If order below Rs. ${restaurantInfo.minimumOrder}, politely inform
- Use emojis sparingly (max 1-2 per message)
- Always confirm order before finalizing`;

export async function getAIResponse(userPhone: string, userMessage: string): Promise<string> {
  let history = conversations.get(userPhone) || [];
  history.push({ role: "user", content: userMessage });

  if (history.length > 10) {
    history = history.slice(-10);
  }

  try {
    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        ...history.map((msg) => ({
          role: msg.role as "user" | "assistant",
          content: msg.content,
        })),
      ],
      temperature: 0.7,
      max_tokens: 300,
    });

    const aiReply = completion.choices[0]?.message?.content || "Maaf kijiye, kuch problem hui.";

    history.push({ role: "assistant", content: aiReply });
    conversations.set(userPhone, history);

    return aiReply;
  } catch (error) {
    console.error("Groq API error:", error);
    return "Maaf kijiye, abhi technical issue hai. Phir try karein.";
  }
}