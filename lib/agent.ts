import Groq from "groq-sdk";
import { ClientConfig, buildFlatMenu, buildMenuText } from "./client-config";
import { savePendingOrder, confirmOrder } from "./orders";
import { isRestaurantOpen, closedMessage } from "./hours";

function getGroqClient() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

type ConversationMessage = {
  role: "user" | "assistant";
  content: string;
};

type ConversationEntry = { history: ConversationMessage[]; lastActiveAt: number };

// Keyed by `${phoneNumberId}:${userPhone}` to isolate per-client conversations
const conversations = new Map<string, ConversationEntry>();

const CONVERSATION_EXPIRY_MS = 2 * 60 * 60 * 1000; // 2 hours

// A conversation is only "genuinely active" if the last interaction was recent.
// Beyond this grace window we treat the old session as stale/inactive even if it
// has not hit the hard expiry, so an apparently new message starts fresh.
const CONVERSATION_ACTIVE_MS = 30 * 60 * 1000; // 30 minutes

// Deterministic, rule-based greeting detection. Kept separate from the LLM
// intent classifier so a fresh/new-session greeting is NEVER skipped.
// This is the SINGLE source of truth for greeting detection.

// Normalize punctuation/hyphens to spaces so "assalam-o-alaikum" and
// "salam, kya haal?" both resolve the same way.
function normalizeText(text: string): string {
  if (!text) return "";
  return text
    .trim()
    .toLowerCase()
    .replace(/[-–—.,!?;:'`"]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "");
}

function isGreetingMessage(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;

  // Arabic greeting substrings (kept before word-boundary regexes).
  const arabicForms = [
    "السلام عليكم",
    "السلام علیکم",
    "سلام عليكم",
    "وعليكم السلام",
  ];
  if (arabicForms.some((g) => normalized.includes(g))) return true;

  // Roman-Urdu / hybrid mappings normalized for "s", "a", "la", "ikum".
  const compact = normalized.replace(/\s+/g, "");
  const salamCompact = /^sala+m(alaikum|al[a]?ikum)?$/.test(compact);
  const assalamCompact = /^s?alamual?al[i]?kum$|^ass?alamo?al[a]?ikum$/.test(compact);

  if (salamCompact || assalamCompact) return true;

  // Full-word / phrase forms mapped after normalization.
  const phraseForms = [
    "salam",
    "salaam",
    "salam alaikum",
    "salamalaikum",
    "asalamualaikum",
    "assalamualaikum",
    "assalamu alaikum",
    "assalamo alaikum",
    "assalam alaikum",
    "assalam o alaikum",
    "salaam alaikum",
    "slm",
    "hi",
    "hello",
    "hey",
    "hola",
  ];
  if (phraseForms.includes(normalized)) return true;

  // Tolerate greetings with extra trailing words, e.g. "salam kya haal".
  if (/^salam( |alaikum|ualikum)/.test(normalized)) return true;

  return false;
}

// Reset keywords — "reset", "restart", "start over", "shuru se", etc.
const RESET_PATTERNS: RegExp[] = [
  /\b(reset|restart|fresh\s*start)\b/i,
  /\b(start\s*over|begin\s*again)\b/i,
  /\b(shuru\s*se|shuru\s*kar|naya\s*shuru|dobara\s*shuru|waps\s*shuru)\b/i,
];

function isResetMessage(text: string): boolean {
  const normalized = normalizeText(text);
  if (!normalized) return false;
  return RESET_PATTERNS.some((re) => re.test(normalized));
}

function buildGreetingResponse(config: ClientConfig): string {
  return (
    config.responses?.greeting ??
    `*Wa alaikum assalam!* 🌙 [GREETING-V2]\n\n` +
      `${config.business.name} mein khush amdeed! 🍛\n\n` +
      `Main aap ki madad kar sakta hoon menu, biryani, prices aur order ke hawale se.\n\n` +
      `📋 "menu" - menu dekhne ke liye\n` +
      `🛒 "1 chicken biryani" - order karne ke liye\n` +
      `💬 Item ka naam - rate puchne ke liye`
  );
}

function buildIntentPrompt(flatMenu: Record<string, number>): string {
  return `You are an intent classifier for a Pakistani restaurant WhatsApp bot.

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
}

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

async function classifyIntent(
  message: string,
  history: ConversationMessage[],
  flatMenu: Record<string, number>
) {
  const recentContext = history
    .slice(-4)
    .map((h) => `${h.role}: ${h.content}`)
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
        { role: "system", content: buildIntentPrompt(flatMenu) },
        { role: "user", content: userInput },
      ],
    });

    return extractJSON(res.choices[0]?.message?.content || "{}");
  } catch (err) {
    console.error("Intent error:", err);
    return { intent: "UNKNOWN", items: [] };
  }
}

function findMenuItem(
  searchName: string,
  flatMenu: Record<string, number>
): string | null {
  if (!searchName) return null;
  const search = searchName.toLowerCase().trim();

  const exact = Object.keys(flatMenu).find((k) => k.toLowerCase() === search);
  if (exact) return exact;

  const contains = Object.keys(flatMenu).find(
    (k) =>
      k.toLowerCase().includes(search) || search.includes(k.toLowerCase())
  );
  if (contains) return contains;

  const searchWords = search.split(/\s+/);
  return (
    Object.keys(flatMenu).find((k) => {
      const itemWords = k.toLowerCase().split(/\s+/);
      return searchWords.some(
        (sw) => sw.length > 2 && itemWords.some((iw) => iw.includes(sw) || sw.includes(iw))
      );
    }) || null
  );
}

function findAllMatches(
  searchName: string,
  flatMenu: Record<string, number>
): string[] {
  if (!searchName) return [];
  const search = searchName.toLowerCase().trim();
  return Object.keys(flatMenu).filter(
    (k) =>
      k.toLowerCase().includes(search) ||
      search.split(/\s+/).some((w) => w.length > 2 && k.toLowerCase().includes(w))
  );
}

type OrderItem = { name: string; qty: number };
type MatchedItem = { name: string; qty: number; price: number; lineTotal: number };

function calculateOrder(items: OrderItem[], flatMenu: Record<string, number>) {
  const matched: MatchedItem[] = [];
  let subtotal = 0;

  for (const item of items) {
    const key = findMenuItem(item.name, flatMenu);
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

function formatOrderConfirmation(
  matched: MatchedItem[],
  subtotal: number,
  config: ClientConfig
) {
  const { currency, deliveryFee, minimumOrder } = config.business;
  const list = matched
    .map((i) => `• ${i.name} x${i.qty} = ${currency} ${i.lineTotal}`)
    .join("\n");

  if (subtotal < minimumOrder) {
    return (
      `🧾 *Aap ka Order:*\n${list}\n\n` +
      `Subtotal: ${currency} ${subtotal}\n\n` +
      `⚠️ Minimum order ${currency} ${minimumOrder} hai.\n` +
      `${currency} ${minimumOrder - subtotal} aur add karein.`
    );
  }

  const total = subtotal + deliveryFee;
  return (
    `🧾 *Aap ka Order:*\n${list}\n\n` +
    `Subtotal: ${currency} ${subtotal}\n` +
    `Delivery: ${currency} ${deliveryFee}\n` +
    `━━━━━━━━━━━━━\n` +
    `*Total: ${currency} ${total}*\n\n` +
    `Confirm karne ke liye "haan" likhein.\n` +
    `Cancel karne ke liye "nahi" likhein.`
  );
}

function formatPriceInfo(
  matched: { name: string; price: number }[],
  currency: string
) {
  return (
    matched.map((i) => `*${i.name}*: ${currency} ${i.price}`).join("\n") +
    `\n\nOrder karna ho to "1 ${matched[0].name}" likhein.`
  );
}

export async function getAIResponse(
  phoneNumberId: string,
  userPhone: string,
  userMessage: string,
  config: ClientConfig
): Promise<string> {
  const flatMenu = buildFlatMenu(config);
  const menuText = buildMenuText(config);
  const { business } = config;
  const currency = business.currency;
  const convKey = `${phoneNumberId}:${userPhone}`;

  const now = Date.now();
  const existing = conversations.get(convKey);
  let isNewSession = true;
  let history: ConversationMessage[] = [];

  // Determine whether this is a genuinely active session.
  // A session is only reused if it exists AND the last interaction is both
  // within the hard expiry AND within the active grace window.
  if (existing) {
    const withinExpiry = now - existing.lastActiveAt < CONVERSATION_EXPIRY_MS;
    const isActive = now - existing.lastActiveAt < CONVERSATION_ACTIVE_MS;
    if (withinExpiry && isActive) {
      history = existing.history;
      isNewSession = false;
    } else {
      console.log(
        `[agent] Session for ${convKey} is stale/inactive (lastActive ${existing.lastActiveAt}), starting fresh`
      );
    }
  }

  console.log(
    `[agent] Entry | user=${userPhone} | session=${convKey} | isNewSession=${isNewSession} | prevHistoryLen=${history.length}`
  );

  // Reset support: clear any existing state before proceeding.
  if (isResetMessage(userMessage)) {
    conversations.delete(convKey);
    history = [];
    isNewSession = true;
    const resetMsg =
      `🔄 Conversation reset ho gaya hai.\n\n` + buildGreetingResponse(config);
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: resetMsg });
    conversations.set(convKey, { history, lastActiveAt: Date.now() });
    console.log(`[agent] RESET | user=${userPhone} | session=${convKey} | nextState='fresh-greeting'`);
    return resetMsg;
  }

  // Greeting detection happens BEFORE normal intent routing so a new/fresh
  // session always starts from step 1 (greeting), never step 2.
  if (isGreetingMessage(userMessage)) {
    const greetingMsg = buildGreetingResponse(config);
    history.push({ role: "user", content: userMessage });
    history.push({ role: "assistant", content: greetingMsg });
    conversations.set(convKey, { history, lastActiveAt: Date.now() });
    console.log(
      `[agent] GREETING | user=${userPhone} | session=${convKey} | isNewSession=${isNewSession} | nextState='greeting'`
    );
    return greetingMsg;
  }

  history.push({ role: "user", content: userMessage });

  if (history.length > 20) {
    history = history.slice(-20);
  }

  let response = "";

  try {
    const intent = await classifyIntent(userMessage, history, flatMenu);
    console.log(
      `[agent] Intent | user=${userPhone} | session=${convKey} | detected=${intent.intent}`
    );

    switch (intent.intent) {
      case "GREETING":
        response = buildGreetingResponse(config);
        break;

      case "MENU":
        response = menuText + `\n\n💬 Order karne ke liye item name likhein.`;
        break;

      case "ITEM_CHECK": {
        const checkItems = intent.items || [];
        if (checkItems.length === 0) {
          response = "Kaunsa item check karna hai? Item ka naam likhein.";
          break;
        }

        const askedItem = checkItems[0].name;
        const found = findMenuItem(askedItem, flatMenu);

        if (found) {
          response =
            `✅ Haan! *${found}* available hai.\n` +
            `Price: ${currency} ${flatMenu[found]}\n\n` +
            `Order karne ke liye "1 ${found}" likhein.`;
        } else {
          response =
            `❌ Maaf kijiye, *${askedItem}* available nahi hai.\n\n` +
            `Hamare paas yeh items hain:\n\n` +
            menuText;
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
          const key = findMenuItem(item.name, flatMenu);
          if (key) {
            priceMatched.push({ name: key, price: flatMenu[key] });
          } else {
            priceNotFound.push(item.name);
          }
        }

        if (priceMatched.length > 0) {
          response = formatPriceInfo(priceMatched, currency);
          if (priceNotFound.length > 0) {
            response += `\n\n❌ Yeh items available nahi: ${priceNotFound.join(", ")}`;
          }
        } else {
          response = `❌ Yeh items available nahi.\n\n` + menuText;
        }
        break;
      }

      case "ORDER": {
        const tz = business.timezone ?? 'Asia/Karachi';
        if (!isRestaurantOpen(business.hours, tz)) {
          response = closedMessage(business.name, business.hours);
          break;
        }

        const orderItems = intent.items || [];
        if (orderItems.length === 0) {
          response = "Kya order karna hai? Item ka naam aur quantity likhein.";
          break;
        }

        let ambiguous = false;
        for (const item of orderItems) {
          const matches = findAllMatches(item.name, flatMenu);
          if (matches.length > 1) {
            const exactMatch = matches.find(
              (m) => m.toLowerCase() === item.name.toLowerCase()
            );
            if (!exactMatch) {
              ambiguous = true;
              response =
                `🤔 "${item.name}" mein kaunsa chahiye?\n\n` +
                matches
                  .map((m, i) => `${i + 1}. ${m} - ${currency} ${flatMenu[m]}`)
                  .join("\n") +
                `\n\nFull naam likh kar bhejein.`;
              break;
            }
          }
        }

        if (!ambiguous) {
          try {
            const { subtotal, matched } = calculateOrder(orderItems, flatMenu);
            const total = subtotal + business.deliveryFee;
            await savePendingOrder(phoneNumberId, userPhone, matched, subtotal, total);
            response = formatOrderConfirmation(matched, subtotal, config);
          } catch (err: any) {
            const errorMsg = err.message || "";
            if (errorMsg.startsWith("ITEM_NOT_FOUND:")) {
              const itemName = errorMsg.replace("ITEM_NOT_FOUND:", "");
              response =
                `❌ Maaf kijiye, *${itemName}* available nahi hai.\n\n` +
                menuText;
            } else {
              console.error("Failed to save pending order:", err);
              response = `⚠️ System error: order save karne mein masla hua. Thori dair baad try karein.`;
            }
          }
        }
        break;
      }

      case "CONFIRM":
        response =
          `✅ Shukriya!\n\n` +
          `Aap ka *delivery address* kya hai?\n\n` +
          `Hum yahan deliver karte hain:\n` +
          `${business.deliveryAreas.map((a) => `• ${a}`).join("\n")}\n\n` +
          `Apna pura address aur phone number bhejein.`;
        break;

      case "CANCEL":
        response = `Order cancel ho gaya. ❌\n\nAur kuch help chahiye? "menu" likhein.`;
        break;

      case "ADDRESS": {
        let order = null;
        try {
          order = await confirmOrder(
            phoneNumberId,
            userPhone,
            userMessage,
            business.deliveryFee
          );
        } catch (err) {
          console.error("Failed to confirm order:", err);
          response = `⚠️ System error: order confirm karne mein masla hua. Thori dair baad try karein.`;
          break;
        }
        if (!order) {
          response =
            config.responses?.noOrderFound ??
            `⚠️ Pending order nahi mila.\n\n` +
              `Pehle apna order dein (e.g. "1 chicken biryani"), phir address bhejein.`;
          break;
        }
        response =
          `✅ *Order confirm ho gaya!*\n\n` +
          `📦 *Order ID: ${order.id}*\n\n` +
          `📞 Confirmation call: ${business.phone}\n` +
          `🛵 Delivery time: ${business.deliveryTime}\n\n` +
          `Shukriya! 🙏`;
        break;
      }

      case "COMPLAINT":
        response =
          `Maaf kijiye, hamare prices fixed hain.\n` +
          `Discount available nahi hai.\n\n` +
          `Order karne ke liye menu dekhein:\n\n` +
          menuText;
        break;

      case "THANKS":
        response =
          `Aap ka shukriya! 🙏\n` +
          `${business.name} ko visit karne ke liye!`;
        break;

      default:
        const norm = normalizeText(userMessage);
        if (isGreetingMessage(userMessage)) {
            console.error("BUG: Greeting reached fallback handler", {
              rawMessage: userMessage,
              normalizedMessage: norm
            });
        }
        response =
          `Maaf kijiye, samajh nahi saka. 🤔\n\n` +
          `Yeh karein:\n\n` +
          `📋 "menu" - menu dekhne ke liye\n` +
          `🛒 "1 chicken biryani" - order ke liye\n` +
          `💬 Item ka naam - rate ke liye`;
    }

    history.push({ role: "assistant", content: response });
    conversations.set(convKey, { history, lastActiveAt: Date.now() });
    console.log(
      `[agent] State | user=${userPhone} | session=${convKey} | nextHistoryLen=${history.length}`
    );
    return response;
  } catch (error) {
    console.error("Agent error:", error);
    return "⚠️ Technical issue hai. Thori dair baad try karein.";
  }
}
