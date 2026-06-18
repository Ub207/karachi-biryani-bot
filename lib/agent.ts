// lib/agent.ts
import Groq from "groq-sdk";
import { flatMenu, restaurantInfo, getMenuText } from "./menu-data";
import { savePendingOrder, confirmOrder } from "./orders";

// Lazy initialization to avoid build-time errors
function getGroqClient() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

const conversations = new Map<string, ConversationMessage[]>();

const INTENT_PROMPT = `You are an intent classifier for a Pakistani restaurant WhatsApp bot.

OUR MENU ITEMS:
${Object.keys(flatMenu).join(", ")}

Return ONLY valid JSON. No explanation. No markdown.

INTENTS:
- GREETING: salam, hi, hello, assalam, salaam, asalamualaikum, etc.
- MENU: user asks for menu, list, what do you have, kya hai, items, etc.
- ORDER: user wants to order specific items
- PRICE_QUERY: user asks price of specific item
- ITEM_CHECK: user asks "do you have X?" (pizza, dahi, etc.)
- CONFIRM: yes, haan, confirm, ok, theek hai
- CANCEL: no, nahi, cancel, mat karo
- ADDRESS: user provides delivery address
- COMPLAINT: discount request, price negotiation
- THANKS: thank you, shukria, thanks
- UNKNOWN: anything else

EXAMPLES:

User: "salam"
{"intent": "GREETING", "items": []}

User: "Assalamu alaikum"
{"intent": "GREETING", "items": []}

User: "menu"
{"intent": "MENU", "items": []}

User: "sindhi biryani"
{"intent": "PRICE_QUERY", "items": [{"name": "Sindhi Biryani Single", "qty": 1}]}

User: "1 chicken biryani family pack"
{"intent": "ORDER", "items": [{"name": "Chicken Biryani Family Pack", "qty": 1}]}

User: "pizza?"
{"intent": "ITEM_CHECK", "items": [{"name": "pizza", "qty": 1}]}

User: "discount do"
{"intent": "COMPLAINT", "items": []}

User: "haan"
{"intent": "CONFIRM", "items": []}

User: "shukria"
{"intent": "THANKS", "items": []}`;

function extractJSON(text: string): any {
  try {
    return JSON.parse(text);
  } catch {}
  
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      return JSON.parse(match[0]);
    } catch {}
  }
  
  return { intent: "UNKNOWN", items: [] };
}

async function classifyIntent(message: string, history: ConversationMessage[]) {
  const recentContext = history.slice(-4)
    .map(h => `${h.role}: ${h.content}`)
    .join("\n");
  
  const userInput = recentContext 
    ? `Conversation:\n${recentContext}\n\nNew message: ${message}`
    : `User message: ${message}`;

  try {
    const groq = getGroqClient();
    const res = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      temperature: 0.1,
      max_tokens: 200,
      messages: [
        { role: "system", content: INTENT_PROMPT },
        { role: "user", content: userInput },
      ],
    });

    return extractJSON(res.choices[0]?.message?.content || "{}");
  } catch (err) {
    console.error("Intent error:", err);
    return { intent: "UNKNOWN", items: [] };
  }
}

function findMenuItem(searchName: string): string | null {
  if (!searchName) return null;
  const search = searchName.toLowerCase().trim();
  
  const exact = Object.keys(flatMenu).find(k => k.toLowerCase() === search);
  if (exact) return exact;
  
  const contains = Object.keys(flatMenu).find(
    k => k.toLowerCase().includes(search) || search.includes(k.toLowerCase())
  );
  if (contains) return contains;
  
  const searchWords = search.split(/\s+/);
  return Object.keys(flatMenu).find(k => {
    const itemWords = k.toLowerCase().split(/\s+/);
    return searchWords.some(sw => 
      sw.length > 2 && itemWords.some(iw => iw.includes(sw) || sw.includes(iw))
    );
  }) || null;
}

function findAllMatches(searchName: string): string[] {
  if (!searchName) return [];
  const search = searchName.toLowerCase().trim();
  return Object.keys(flatMenu).filter(
    k => k.toLowerCase().includes(search) || 
         search.split(/\s+/).some(w => w.length > 2 && k.toLowerCase().includes(w))
  );
}

type OrderItem = { name: string; qty: number };
type MatchedItem = { name: string; qty: number; price: number; lineTotal: number };

function calculateOrder(items: OrderItem[]) {
  const matched: MatchedItem[] = [];
  let subtotal = 0;
  
  for (const item of items) {
    const key = findMenuItem(item.name);
    if (!key) {
      throw new Error(`ITEM_NOT_FOUND:${item.name}`);
    }
    
    const qty = item.qty || 1;
    const price = flatMenu[key];
    const lineTotal = price * qty;
    
    matched.push({ name: key, qty, price, lineTotal });
    subtotal += lineTotal;
  }
  
  return { subtotal, matched };
}

function formatOrderConfirmation(matched: MatchedItem[], subtotal: number) {
  const list = matched
    .map(i => `• ${i.name} x${i.qty} = Rs. ${i.lineTotal}`)
    .join("\n");

  const deliveryFee = restaurantInfo.deliveryFee;
  const total = subtotal + deliveryFee;
  const minOrder = restaurantInfo.minimumOrder;
  
  if (subtotal < minOrder) {
    return `🧾 *Aap ka Order:*\n${list}\n\n` +
      `Subtotal: Rs. ${subtotal}\n\n` +
      `⚠️ Minimum order Rs. ${minOrder} hai.\n` +
      `Rs. ${minOrder - subtotal} aur add karein.`;
  }

  return `🧾 *Aap ka Order:*\n${list}\n\n` +
    `Subtotal: Rs. ${subtotal}\n` +
    `Delivery: Rs. ${deliveryFee}\n` +
    `━━━━━━━━━━━━━\n` +
    `*Total: Rs. ${total}*\n\n` +
    `Confirm karne ke liye "haan" likhein.\n` +
    `Cancel karne ke liye "nahi" likhein.`;
}

function formatPriceInfo(matched: { name: string; price: number }[]) {
  return matched
    .map(i => `*${i.name}*: Rs. ${i.price}`)
    .join("\n") +
    `\n\nOrder karna ho to "1 ${matched[0].name}" likhein.`;
}

export async function getAIResponse(
  userPhone: string,
  userMessage: string
): Promise<string> {
  let history = conversations.get(userPhone) || [];
  history.push({ role: "user", content: userMessage });

  if (history.length > 20) {
    history = history.slice(-20);
  }

  let response = "";

  try {
    const intent = await classifyIntent(userMessage, history);
    console.log("Intent:", intent);

    switch (intent.intent) {
      case "GREETING":
        response = 
          `*Wa alaikum assalam!* 🌙\n\n` +
          `${restaurantInfo.name} mein khush amdeed!\n\n` +
          `Main aap ki kaise help kar sakta hoon?\n\n` +
          `📋 "menu" - menu dekhne ke liye\n` +
          `🛒 "1 chicken biryani" - order karne ke liye\n` +
          `💬 Item ka naam - rate puchne ke liye`;
        break;

      case "MENU":
        response = getMenuText() + 
          `\n\n💬 Order karne ke liye item name likhein.`;
        break;

      case "ITEM_CHECK": {
        const checkItems = intent.items || [];
        if (checkItems.length === 0) {
          response = "Kaunsa item check karna hai? Item ka naam likhein.";
          break;
        }
        
        const askedItem = checkItems[0].name;
        const found = findMenuItem(askedItem);
        
        if (found) {
          response = 
            `✅ Haan! *${found}* available hai.\n` +
            `Price: Rs. ${flatMenu[found]}\n\n` +
            `Order karne ke liye "1 ${found}" likhein.`;
        } else {
          response = 
            `❌ Maaf kijiye, *${askedItem}* available nahi hai.\n\n` +
            `Hamare paas yeh items hain:\n\n` +
            getMenuText();
        }
        break;
      }

      case "PRICE_QUERY": {
        const priceItems = intent.items || [];
        if (priceItems.length === 0) {
          response = "Kaunsa item ka rate puchna hai?";
          break;
        }
        
        const priceMatched: { name: string; price: number }[] = [];
        const priceNotFound: string[] = [];
        
        for (const item of priceItems) {
          const key = findMenuItem(item.name);
          if (key) {
            priceMatched.push({ name: key, price: flatMenu[key] });
          } else {
            priceNotFound.push(item.name);
          }
        }
        
        if (priceMatched.length > 0) {
          response = formatPriceInfo(priceMatched);
          if (priceNotFound.length > 0) {
            response += `\n\n❌ Yeh items available nahi: ${priceNotFound.join(", ")}`;
          }
        } else {
          response = `❌ Yeh items available nahi.\n\n` + getMenuText();
        }
        break;
      }

      case "ORDER": {
        const orderItems = intent.items || [];
        if (orderItems.length === 0) {
          response = "Kya order karna hai? Item ka naam aur quantity likhein.";
          break;
        }
        
        let ambiguous = false;
        for (const item of orderItems) {
          const matches = findAllMatches(item.name);
          if (matches.length > 1) {
            const exactMatch = matches.find(m => 
              m.toLowerCase() === item.name.toLowerCase()
            );
            if (!exactMatch) {
              ambiguous = true;
              response = 
                `🤔 "${item.name}" mein kaunsa chahiye?\n\n` +
                matches.map((m, i) => `${i + 1}. ${m} - Rs. ${flatMenu[m]}`).join("\n") +
                `\n\nFull naam likh kar bhejein.`;
              break;
            }
          }
        }
        
        if (!ambiguous) {
          try {
            const { subtotal, matched } = calculateOrder(orderItems);
            const total = subtotal + restaurantInfo.deliveryFee;
            response = formatOrderConfirmation(matched, subtotal);
            await savePendingOrder(userPhone, matched, subtotal, total).catch((err) =>
              console.error("Failed to save pending order:", err)
            );
          } catch (err: any) {
            const errorMsg = err.message || "";
            const itemName = errorMsg.replace("ITEM_NOT_FOUND:", "");
            response =
              `❌ Maaf kijiye, *${itemName}* available nahi hai.\n\n` +
              getMenuText();
          }
        }
        break;
      }

      case "CONFIRM":
        response = 
          `✅ Shukriya!\n\n` +
          `Aap ka *delivery address* kya hai?\n\n` +
          `Hum yahan deliver karte hain:\n` +
          `${restaurantInfo.deliveryAreas.map(a => `• ${a}`).join("\n")}\n\n` +
          `Apna pura address aur phone number bhejein.`;
        break;

      case "CANCEL":
        response = `Order cancel ho gaya. ❌\n\nAur kuch help chahiye? "menu" likhein.`;
        break;

      case "ADDRESS": {
        const order = await confirmOrder(userPhone, userMessage).catch((err) => {
          console.error("Failed to confirm order:", err);
          return null;
        });
        response =
          `✅ *Address note ho gaya!*\n\n` +
          (order ? `📦 *Order ID: ${order.id}*\n\n` : "") +
          `📞 Confirmation call: ${restaurantInfo.phone}\n` +
          `🛵 Delivery time: ${restaurantInfo.deliveryTime}\n\n` +
          `Shukriya! 🙏`;
        break;
      }

      case "COMPLAINT":
        response = 
          `Maaf kijiye, hamare prices fixed hain.\n` +
          `Discount available nahi hai.\n\n` +
          `Order karne ke liye menu dekhein:\n\n` +
          getMenuText();
        break;

      case "THANKS":
        response = 
          `Aap ka shukriya! 🙏\n` +
          `${restaurantInfo.name} ko visit karne ke liye!`;
        break;

      default:
        response = 
          `Maaf kijiye, samajh nahi saka. 🤔\n\n` +
          `Yeh karein:\n\n` +
          `📋 "menu" - menu dekhne ke liye\n` +
          `🛒 "1 chicken biryani" - order ke liye\n` +
          `💬 Item ka naam - rate ke liye`;
    }

    history.push({ role: "assistant", content: response });
    conversations.set(userPhone, history);
    return response;

  } catch (error) {
    console.error("Agent error:", error);
    return "⚠️ Technical issue hai. Thori dair baad try karein.";
  }
}