import Groq from "groq-sdk";
import { ClientConfig, buildFlatMenu, buildMenuText } from "./client-config";
import {
  clearOrderDraft,
  finalizeOrderDraft,
  getOrderDraft,
  OrderDraft,
  OrderItem as PersistedOrderItem,
  saveOrderDraft,
  getLatestOrderForUser,
  getOrderById,
} from "./orders";
import { isRestaurantOpen, closedMessage } from "./hours";

type ConversationMessage = { role: "user" | "assistant"; content: string };
type ConversationEntry = { history: ConversationMessage[]; lastActiveAt: number };
type IntentName =
  | "GREETING"
  | "MENU"
  | "ORDER"
  | "PRICE_QUERY"
  | "ITEM_CHECK"
  | "CONFIRM"
  | "CANCEL"
  | "ADDRESS"
  | "COMPLAINT"
  | "THANKS"
  | "UNKNOWN";

type OrderItem = { name: string; qty: number };
type IntentResult = { intent: IntentName; items: OrderItem[] };

export type DeterministicRoute =
  | { kind: "intent"; intent: IntentResult }
  | { kind: "ambiguous"; itemName: string; matches: string[] }
  | { kind: "ITEM_NOT_AVAILABLE"; itemName: string }
  | { kind: "CHEAPEST_ITEM"; item: string; price: number }
  | { kind: "BUDGET_QUERY"; budget: number; items: { name: string; price: number }[] }
  | { kind: "DELIVERY_AREAS" }
  | { kind: "DELIVERY_ETA" }
  | { kind: "ORDER_STATUS"; orderId?: string };

const conversations = new Map<string, ConversationEntry>();
const CONVERSATION_ACTIVE_MS = 30 * 60 * 1000;
const INTENTS = new Set<IntentName>([
  "GREETING",
  "MENU",
  "ORDER",
  "PRICE_QUERY",
  "ITEM_CHECK",
  "CONFIRM",
  "CANCEL",
  "ADDRESS",
  "COMPLAINT",
  "THANKS",
  "UNKNOWN",
]);

export function normalizeText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[-–—.,!?;:'`"()]+/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

export function isGreetingMessage(message: string): boolean {
  const norm = normalizeText(message);
  return (
    [
      "hi",
      "hello",
      "hey",
      "salam",
      "salaam",
      "salam alaikum",
      "assalam o alaikum",
      "assalam u alaikum",
      "assalamu alaikum",
      "assalamualaikum",
      "asalamualaikum",
      "aoa",
      "السلام عليكم",
      "السلام علیکم",
    ].includes(norm) || /^(salam|salaam|assalam|aoa\b)/i.test(norm)
  );
}

export function isMenuRequest(message: string): boolean {
  const norm = normalizeText(message);
  return (
    [
      "menu",
      "show menu",
      "menu please",
      "rates",
      "rate list",
      "prices",
      "price list",
      "list",
      "items",
      "kya items hain",
      "kya hai menu mein",
      "menu kya hai",
      "menu card",
      "menu dikhao",
      "menu bhejo",
    ].includes(norm) || norm.includes("menu card")
  );
}

export function isConfirmMessage(message: string): boolean {
  return [
    "haan",
    "han",
    "ha",
    "yes",
    "yep",
    "ok",
    "okay",
    "confirm",
    "confirmed",
    "ji",
    "jee",
    "bilkul",
    "theek hai",
    "thik hai",
  ].includes(normalizeText(message));
}

export function isCancelMessage(message: string): boolean {
  return [
    "nahi",
    "nahin",
    "nhi",
    "no",
    "cancel",
    "cancel order",
    "order cancel",
    "mat karo",
    "rehne do",
    "nahi chahiye",
    "cancel kardo",
  ].includes(normalizeText(message));
}

export function isThanksMessage(message: string): boolean {
  return [
    "shukria",
    "shukriya",
    "thanks",
    "thank you",
    "thx",
    "jazakallah",
  ].includes(normalizeText(message));
}

export function isResetMessage(message: string): boolean {
  return /\b(reset|restart|start\s*over|shuru\s*se)\b/i.test(normalizeText(message));
}

export function isDeliveryAreaQuery(message: string): boolean {
  const norm = normalizeText(message);
  return (
    (/\b(delivery|deliver)\b/i.test(norm) &&
      /\b(karachi|kahan|areas|area|ilaqe|ilaqa|konsay|konse|places|locations|hoti|karte|available)\b/i.test(
        norm
      )) ||
    (/^delivery\b/i.test(norm) && norm.includes("karachi"))
  );
}

export function isDeliveryEtaQuery(message: string): boolean {
  const norm = normalizeText(message);
  return /\b(kitni dair|kitna time|kitni der|der lagegi|dair lagegi|delivery time|kab tak|eta|time kitna|time lagega)\b/i.test(
    norm
  );
}

export function parseOrderStatusQuery(message: string): { isStatus: boolean; orderId?: string } {
  const norm = normalizeText(message);
  const idMatch = message.match(/\b(ORD-[A-Z0-9]+)\b/i);
  if (idMatch) return { isStatus: true, orderId: idMatch[1].toUpperCase() };
  if (
    /\b(mera order|order status|order kahan|order kab|track order|kahan hai order|kahan pohncha|status kya hai)\b/i.test(
      norm
    )
  ) {
    return { isStatus: true };
  }
  return { isStatus: false };
}

export function parseBudgetQuery(message: string): number | null {
  const norm = normalizeText(message);
  const underMatch = norm.match(/\b(?:under|below|less than)\s+(\d+)\b/i);
  if (underMatch) return Number(underMatch[1]);

  const numFirstMatch = norm.match(/\b(\d+)\s*(?:se kam|tak|ke under|ke andar|mein kya|budget)\b/i);
  if (numFirstMatch) return Number(numFirstMatch[1]);

  return null;
}

export function findMenuItem(searchName: string, menu: Record<string, number>): string | null {
  const search = normalizeText(searchName);
  if (!search) return null;
  const keys = Object.keys(menu);
  const words = search.split(" ").filter((word) => word.length > 2);
  return (
    keys.find((key) => normalizeText(key) === search) ??
    keys.find((key) => normalizeText(key).includes(search) || search.includes(normalizeText(key))) ??
    (words.length ? keys.find((key) => words.every((word) => normalizeText(key).includes(word))) : null) ??
    null
  );
}

export function findAllMatches(searchName: string, menu: Record<string, number>): string[] {
  const search = normalizeText(searchName);
  if (!search) return [];
  const words = search.split(" ").filter(Boolean);
  return Object.keys(menu).filter((key) => {
    const item = normalizeText(key);
    if (item.includes(search)) return true;
    if (words.length > 1) return words.every((word) => item.includes(word));
    return words.some((word) => word.length > 2 && item.includes(word));
  });
}

export function parseAvailabilityQuery(message: string): string | null {
  const norm = normalizeText(message);
  if (
    isGreetingMessage(message) ||
    isMenuRequest(message) ||
    isConfirmMessage(message) ||
    isCancelMessage(message) ||
    isThanksMessage(message) ||
    isResetMessage(message) ||
    isDeliveryAreaQuery(message) ||
    isDeliveryEtaQuery(message) ||
    parseOrderStatusQuery(message).isStatus ||
    parseBudgetQuery(message) !== null ||
    /\b(sab se sasti|sab se sasta|cheapest|sasti cheez|sasta item|sab se kam rate)\b/i.test(norm)
  ) {
    return null;
  }

  // General "what is" question (e.g. "cricket score kya hai?", "capital kya hai?")
  // should not be treated as item availability unless it mentions food availability indicators
  if (
    /\bkya\s+(hai|he|h)\b/i.test(norm) &&
    !/\b(available|milta|milti|maujood|paas|to nahi hai|nahi hai|nahin hai|nhi hai)\b/i.test(norm)
  ) {
    return null;
  }

  const hasIndicator =
    /\b(h|hai|he|available|milta|milti|maujood)\b/i.test(norm) ||
    /^(do you have|kya aap ke paas|aap ke paas)\b/i.test(norm);
  if (!hasIndicator) return null;

  let cleaned = norm
    .replace(/^(do you have|kya aap ke paas|aap ke paas|kya)\s+/i, "")
    .replace(/\b(to nahi hai|nahi hai|nahin hai|nhi hai|nahi h|nahin h|nhi h|nahi he|nahi|nahin|nhi)\b/gi, "")
    .replace(/\b(available|milta|milti|maujood|hai|he|h|kya)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  cleaned = cleaned.replace(/\b(hai|ha|han|ji)\b$/i, "").trim();
  return cleaned && cleaned.length <= 60 ? cleaned : null;
}

export function parsePriceQuery(message: string): string | null {
  const norm = normalizeText(message);
  if (/\b(rate|price|qeemat|kitne ka|kitne ki|cost)\b/i.test(norm)) {
    const item = norm
      .replace(
        /\b(kya rate hai|rate kya hai|price kya hai|rate|price|qeemat|kitne ka hai|kitne ki hai|kitne ka|kitne ki|cost|kya hai|batao|bataen)\b/gi,
        ""
      )
      .replace(/\b(ka|ki|ke|hai|h|he)\b/gi, "")
      .replace(/\s+/g, " ")
      .trim();
    return item || null;
  }
  return null;
}

function cleanOrderPart(part: string): string {
  return part
    .replace(/^(?:mujhe|humein|humay|bhai|yaar)\s+/i, "")
    .replace(/\s+(?:chahiye|bhej\s*(?:do|dein)|pack\s*(?:kardo|kar\s*do|karein)|kardo|lao|dein|chahye)$/i, "")
    .trim();
}

export function parseOrder(message: string, menu: Record<string, number>): OrderItem[] | null {
  if (
    isGreetingMessage(message) ||
    isMenuRequest(message) ||
    isConfirmMessage(message) ||
    isCancelMessage(message) ||
    isThanksMessage(message) ||
    isResetMessage(message) ||
    isDeliveryAreaQuery(message) ||
    isDeliveryEtaQuery(message) ||
    parseOrderStatusQuery(message).isStatus ||
    parseBudgetQuery(message) !== null ||
    parseAvailabilityQuery(message) !== null ||
    /\b(sab se sasti|cheapest)\b/i.test(normalizeText(message))
  ) {
    return null;
  }

  const norm = normalizeText(message);
  const parts = message.split(/\s*(?:,|\band\b|\baur\b|\+|\n)\s*/i).filter(Boolean);
  const rawItems: { name: string; qty: number; hasExplicitQtyOrIntent: boolean }[] = [];

  for (const part of parts) {
    const cleaned = cleanOrderPart(normalizeText(part));
    if (!cleaned) continue;

    // Pattern 1: Leading quantity: "1 chicken biryani", "2x naan", "5 plate biryani"
    const leadMatch = cleaned.match(/^(\d+)\s*(?:x\s*|plate\s*|plates\s*)?(.+)$/i);
    if (leadMatch && /^\d+$/.test(leadMatch[1])) {
      const qty = Number(leadMatch[1]);
      const name = leadMatch[2].trim();
      if (qty >= 1 && qty <= 99 && name.length > 0) {
        rawItems.push({ name, qty, hasExplicitQtyOrIntent: true });
        continue;
      }
    }

    // Pattern 2: Trailing quantity: "chicken biryani 2", "naan 3 plate"
    const trailMatch = cleaned.match(/^(.+?)\s*(\d+)(?:\s*(?:plate|plates|x))?$/i);
    if (trailMatch && /^\d+$/.test(trailMatch[2])) {
      const name = trailMatch[1].trim();
      const qty = Number(trailMatch[2]);
      if (qty >= 1 && qty <= 99 && name.length > 0) {
        rawItems.push({ name, qty, hasExplicitQtyOrIntent: true });
        continue;
      }
    }

    // Pattern 3: No quantity given. Check if cleaned matches a menu item or ordering keywords exist
    const hasOrderingWord = /\b(chahiye|order|bhej|pack|lao)\b/i.test(norm);
    const matchesMenu = findAllMatches(cleaned, menu).length > 0 || findMenuItem(cleaned, menu) !== null;
    if (matchesMenu || hasOrderingWord) {
      rawItems.push({ name: cleaned, qty: 1, hasExplicitQtyOrIntent: true });
    }
  }

  if (!rawItems.length || !rawItems.some((i) => i.hasExplicitQtyOrIntent)) {
    return null;
  }

  return rawItems.map((i) => ({ name: i.name, qty: i.qty }));
}

export function routeDeterministically(message: string, menu: Record<string, number>): DeterministicRoute | null {
  if (isMenuRequest(message)) return { kind: "intent", intent: { intent: "MENU", items: [] } };
  if (isConfirmMessage(message)) return { kind: "intent", intent: { intent: "CONFIRM", items: [] } };
  if (isCancelMessage(message)) return { kind: "intent", intent: { intent: "CANCEL", items: [] } };
  if (isThanksMessage(message)) return { kind: "intent", intent: { intent: "THANKS", items: [] } };

  // Delivery ETA
  if (isDeliveryEtaQuery(message)) {
    return { kind: "DELIVERY_ETA" };
  }

  // Delivery availability/areas
  if (isDeliveryAreaQuery(message)) {
    return { kind: "DELIVERY_AREAS" };
  }

  // Order status
  const orderStatus = parseOrderStatusQuery(message);
  if (orderStatus.isStatus) {
    return { kind: "ORDER_STATUS", orderId: orderStatus.orderId };
  }

  // Cheapest item query
  const norm = normalizeText(message);
  if (/\b(sab se sasti|sab se sasta|cheapest|sasti cheez|sasta item|sab se kam rate|sab se kam qeemat)\b/i.test(norm)) {
    const entries = Object.entries(menu);
    if (entries.length > 0) {
      const minPrice = Math.min(...entries.map(([, p]) => p));
      const cheapest = entries.find(([, p]) => p === minPrice);
      if (cheapest) {
        return { kind: "CHEAPEST_ITEM", item: cheapest[0], price: cheapest[1] };
      }
    }
  }

  // Budget filtering
  const budget = parseBudgetQuery(message);
  if (budget !== null) {
    const affordable = Object.entries(menu)
      .filter(([, price]) => price <= budget)
      .sort((a, b) => a[1] - b[1])
      .map(([name, price]) => ({ name, price }));
    return { kind: "BUDGET_QUERY", budget, items: affordable };
  }

  // Product availability query: "pizza h?", "chicken biryani nahi hai?", etc.
  const availability = parseAvailabilityQuery(message);
  if (availability) {
    const matches = findAllMatches(availability, menu);
    const exact = matches.find((m) => normalizeText(m) === normalizeText(availability));
    const single = matches.find((m) => normalizeText(m).replace(/\bsingle\b/, "").trim() === normalizeText(availability));
    const found = exact ?? single ?? (matches.length === 1 ? matches[0] : findMenuItem(availability, menu));
    if (found) {
      return { kind: "intent", intent: { intent: "ITEM_CHECK", items: [{ name: found, qty: 1 }] } };
    }
    if (matches.length > 1) {
      return { kind: "ambiguous", itemName: availability, matches };
    }
    return { kind: "ITEM_NOT_AVAILABLE", itemName: availability };
  }

  // Specific price query: "chicken biryani ka rate kya hai"
  const priceItem = parsePriceQuery(message);
  if (priceItem) {
    const match = findMenuItem(priceItem, menu);
    if (match) {
      return { kind: "intent", intent: { intent: "PRICE_QUERY", items: [{ name: match, qty: 1 }] } };
    }
  }

  // Multi-item / standard order parsing
  const items = parseOrder(message, menu);
  if (!items) return null;
  const resolved: OrderItem[] = [];
  for (const item of items) {
    const matches = findAllMatches(item.name, menu);
    const exact = matches.find((m) => normalizeText(m) === normalizeText(item.name));
    const single = matches.find((m) => normalizeText(m).replace(/\bsingle\b/, "").trim() === normalizeText(item.name));
    if (matches.length > 1 && !exact && !single) return { kind: "ambiguous", itemName: item.name, matches };
    const match = exact ?? single ?? findMenuItem(item.name, menu);
    if (!match) return { kind: "ITEM_NOT_AVAILABLE", itemName: item.name };
    resolved.push({ name: match, qty: item.qty });
  }
  return { kind: "intent", intent: { intent: "ORDER", items: resolved } };
}

export function normalizeIntent(value: unknown): IntentName {
  const intent = String(value ?? "UNKNOWN").trim().toUpperCase();
  return INTENTS.has(intent as IntentName) ? (intent as IntentName) : "UNKNOWN";
}

function extractJSON(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    try {
      return match ? JSON.parse(match[0]) : {};
    } catch {
      return {};
    }
  }
}

export function parseIntentResponse(text: string): IntentResult {
  const parsed = extractJSON(text);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { intent: "UNKNOWN", items: [] };
  const record = parsed as Record<string, unknown>;
  const items = Array.isArray(record.items)
    ? record.items.flatMap((item) => {
        if (!item || typeof item !== "object" || typeof (item as { name?: unknown }).name !== "string") return [];
        const candidate = item as { name: string; qty?: unknown };
        const qty = Number(candidate.qty);
        return candidate.name.trim() && Number.isSafeInteger(qty) && qty > 0
          ? [{ name: candidate.name.trim(), qty }]
          : [];
      })
    : [];
  return { intent: normalizeIntent(record.intent), items };
}

const GROQ_MODEL = process.env.GROQ_MODEL || "openai/gpt-oss-120b";
function getGroqClient() {
  return new Groq({ apiKey: process.env.GROQ_API_KEY });
}

// Returns null when the classifier is unavailable or fails — callers must degrade
// gracefully. Internal failures are logged here, never surfaced to customers.
async function classifyIntent(
  message: string,
  history: ConversationMessage[],
  menu: Record<string, number>
): Promise<IntentResult | null> {
  if (!process.env.GROQ_API_KEY) {
    console.warn("[agent] classifier_unavailable", { reason: "missing_api_key" });
    return null;
  }
  const prompt = `You classify Pakistani restaurant messages. Menu: ${Object.keys(menu).join(", ")}. Return only JSON: {"intent":"GREETING|MENU|ORDER|PRICE_QUERY|ITEM_CHECK|CONFIRM|CANCEL|ADDRESS|COMPLAINT|THANKS|UNKNOWN","items":[{"name":"string","qty":1}]}.`;
  const context = history
    .slice(-4)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join("\n");
  try {
    const response = await getGroqClient().chat.completions.create({
      model: GROQ_MODEL,
      temperature: 0.1,
      max_tokens: 300,
      messages: [
        { role: "system", content: prompt },
        { role: "user", content: context ? `${context}\nuser: ${message}` : message },
      ],
    });
    return parseIntentResponse(response.choices[0]?.message?.content ?? "{}");
  } catch (error) {
    console.error("[agent] classifier_unavailable", { error });
    return null;
  }
}

function safeItemName(value: string): string {
  return value.replace(/[*_~`\\]/g, "").trim().slice(0, 60) || "yeh item";
}

// Customer-friendly "not on the menu" reply — lists what we DO have.
function formatItemNotAvailable(itemName: string, menu: Record<string, number>): string {
  const names = Array.from(new Set(Object.keys(menu).map((name) => name.replace(/\s+single$/i, ""))));
  return `Maaf kijiye, ${safeItemName(itemName)} hamare menu mein available nahi hai.\n\nHamare paas:\n${names.map((name) => `- ${name}`).join("\n")}\n\nmaujood hain.\n\nAap in mein se kya order karna chahenge?`;
}

function toPersistedItems(
  items: OrderItem[],
  menu: Record<string, number>
): PersistedOrderItem[] | { kind: "ITEM_NOT_AVAILABLE"; itemName: string } {
  const matched: PersistedOrderItem[] = [];
  for (const item of items) {
    const menuItem = findMenuItem(item.name, menu);
    if (!menuItem) return { kind: "ITEM_NOT_AVAILABLE", itemName: item.name };
    if (!Number.isSafeInteger(item.qty) || item.qty < 1 || item.qty > 99) {
      return { kind: "ITEM_NOT_AVAILABLE", itemName: item.name };
    }
    const price = menu[menuItem];
    matched.push({ name: menuItem, qty: item.qty, price, lineTotal: price * item.qty });
  }
  return matched;
}

function isQuantity(message: string): number | null {
  const normalized = normalizeText(message);
  if (!/^\d+$/.test(normalized)) return null;
  const quantity = Number(normalized);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 99 ? quantity : null;
}

function formatAddressPrompt(config: ClientConfig): string {
  return `Delivery address batayein.\n\nHum yahan deliver karte hain:\n${config.business.deliveryAreas.map((area) => `• ${area}`).join("\n")}`;
}

function makeDraft(
  phase: OrderDraft["phase"],
  items: PersistedOrderItem[],
  deliveryFee: number,
  address?: string
): OrderDraft {
  const now = new Date().toISOString();
  const subtotal = items.reduce((sum, item) => sum + item.lineTotal, 0);
  return {
    phase,
    items,
    subtotal,
    deliveryFee,
    total: subtotal + deliveryFee,
    address,
    confirmation: phase === "AWAITING_CONFIRMATION" ? "PENDING" : "NOT_ASKED",
    createdAt: now,
    updatedAt: now,
  };
}

function formatDraftSummary(draft: OrderDraft, currency: string): string {
  const items = draft.items.map((item) => `${item.qty} ${item.name}`).join("\n");
  return `Aapka order:\n\n${items}\n\nTotal: ${currency} ${draft.subtotal}\nDelivery: ${currency} ${draft.deliveryFee}\n━━━━━━━━━━━━━\nGrand Total: ${currency} ${draft.total}\n\nAddress: ${draft.address}\n\nConfirm karein?\n(Yes / No)`;
}

function promptForQuantity(item: PersistedOrderItem): string {
  return `Kitni quantity chahiye?\n\n(${item.name} — ${item.price} per unit)`;
}

function minimumOrderMessage(shortfall: number, minimum: number, currency: string): string {
  return `⚠️ Minimum order ${currency} ${minimum} hai.\n\n${currency} ${shortfall} aur add karein, ya menu dekhein: "menu" likhein.`;
}

function buildGreetingResponse(config: ClientConfig): string {
  return (
    config.responses?.greeting ??
    `${config.business.name} mein khush amdeed! 🍛\n\n"menu" likh kar menu dekhein, ya "1 chicken biryani" likh kar order karein.`
  );
}

function draftReprompt(draft: OrderDraft, config: ClientConfig): string {
  if (draft.phase === "AWAITING_QUANTITY")
    return `${promptForQuantity(draft.items[0])}\n\nOrder badalne ke liye "cancel" likhein.`;
  if (draft.phase === "AWAITING_ADDRESS")
    return `${formatAddressPrompt(config)}\n\nOrder cancel karne ke liye "cancel" likhein.`;
  return "Confirm karne ke liye Yes, cancel karne ke liye No likhein.";
}

export async function getAIResponse(
  phoneNumberId: string,
  userPhone: string,
  userMessage: string,
  config: ClientConfig
): Promise<string> {
  const menu = buildFlatMenu(config);
  const menuText = buildMenuText(config);
  const currency = config.business.currency;
  const convKey = `${phoneNumberId}:${userPhone}`;
  const existing = conversations.get(convKey);
  let history: ConversationMessage[] =
    existing && Date.now() - existing.lastActiveAt < CONVERSATION_ACTIVE_MS ? existing.history : [];
  const finish = (response: string) => {
    const next: ConversationMessage[] = [
      ...history,
      { role: "user", content: userMessage },
      { role: "assistant", content: response },
    ];
    history = next.slice(-20);
    conversations.set(convKey, { history, lastActiveAt: Date.now() });
    return response;
  };

  try {
    if (isResetMessage(userMessage)) {
      conversations.delete(convKey);
      await clearOrderDraft(phoneNumberId, userPhone);
      return finish(`Conversation reset ho gaya hai.\n\n${buildGreetingResponse(config)}`);
    }
    if (isGreetingMessage(userMessage)) return finish(buildGreetingResponse(config));

    // State machine: active order draft steers the conversation
    const draft = await getOrderDraft(phoneNumberId, userPhone);
    if (draft) {
      if (isCancelMessage(userMessage)) {
        await clearOrderDraft(phoneNumberId, userPhone);
        return finish('Order cancel ho gaya.\n\nAur kuch help chahiye? "menu" likhein.');
      }
      if (draft.phase === "AWAITING_QUANTITY") {
        const quantity = isQuantity(userMessage);
        if (quantity !== null) {
          const item = { ...draft.items[0], qty: quantity, lineTotal: draft.items[0].price * quantity };
          const updated = makeDraft("AWAITING_ADDRESS", [item], draft.deliveryFee);
          if (updated.subtotal < config.business.minimumOrder) {
            return finish(
              minimumOrderMessage(
                config.business.minimumOrder - updated.subtotal,
                config.business.minimumOrder,
                currency
              )
            );
          }
          await saveOrderDraft(phoneNumberId, userPhone, updated);
          return finish(formatAddressPrompt(config));
        }
      } else if (draft.phase === "AWAITING_ADDRESS") {
        const looksLikeCommand =
          isMenuRequest(userMessage) ||
          isGreetingMessage(userMessage) ||
          isThanksMessage(userMessage) ||
          isConfirmMessage(userMessage) ||
          isDeliveryAreaQuery(userMessage) ||
          isDeliveryEtaQuery(userMessage) ||
          parseOrderStatusQuery(userMessage).isStatus;
        const address = userMessage.trim();
        if (!looksLikeCommand && address.length >= 4) {
          const updated: OrderDraft = {
            ...draft,
            phase: "AWAITING_CONFIRMATION",
            address,
            confirmation: "PENDING",
            updatedAt: new Date().toISOString(),
          };
          await saveOrderDraft(phoneNumberId, userPhone, updated);
          return finish(formatDraftSummary(updated, currency));
        }
        if (!looksLikeCommand) {
          return finish('Pura delivery address batayein (e.g. "Gulshan Block 5").');
        }
      } else if (draft.phase === "AWAITING_CONFIRMATION") {
        if (isConfirmMessage(userMessage)) {
          const order = await finalizeOrderDraft(phoneNumberId, userPhone);
          if (!order)
            return finish('Order confirm nahi ho saka. Thori dair baad "Yes" likh kar dobara try karein.');
          return finish(
            `✅ Order confirm ho gaya.\n\nOrder ID: ${order.id}\n\nEstimated delivery:\n${config.business.deliveryTime}.`
          );
        }
        if (isCancelMessage(userMessage)) {
          await clearOrderDraft(phoneNumberId, userPhone);
          return finish("Order cancel ho gaya.");
        }
      }
    }

    const route = routeDeterministically(userMessage, menu);

    if (route?.kind === "ITEM_NOT_AVAILABLE") {
      return finish(formatItemNotAvailable(route.itemName, menu));
    }
    if (route?.kind === "ambiguous") {
      return finish(
        `"${route.itemName}" mein kaunsa chahiye?\n\n${route.matches
          .map((item, index) => `${index + 1}. ${item} - ${currency} ${menu[item]}`)
          .join("\n")}\n\nFull naam likh kar bhejein.`
      );
    }
    if (route?.kind === "CHEAPEST_ITEM") {
      return finish(
        `Hamare menu mein sab se sasti item *${route.item}* hai (${currency} ${route.price}).\n\nOrder karne ke liye "1 ${route.item}" likhein.`
      );
    }
    if (route?.kind === "BUDGET_QUERY") {
      if (route.items.length > 0) {
        return finish(
          `${currency} ${route.budget} ke budget mein yeh items available hain:\n\n${route.items
            .map((i) => `• ${i.name} - ${currency} ${i.price}`)
            .join("\n")}\n\nOrder karne ke liye item ka naam likhein.`
        );
      }
      const cheapest = Object.entries(menu).reduce((a, b) => (b[1] < a[1] ? b : a));
      return finish(
        `Maaf kijiye, ${currency} ${route.budget} se kam mein koi item available nahi hai.\n\nHamari sab se sasti item *${cheapest[0]}* (${currency} ${cheapest[1]}) hai.`
      );
    }
    if (route?.kind === "DELIVERY_AREAS") {
      return finish(
        `Ji haan! Hum Karachi mein in ilaaqon mein deliver karte hain:\n\n${config.business.deliveryAreas
          .map((area) => `• ${area}`)
          .join("\n")}\n\n• Minimum order: ${currency} ${config.business.minimumOrder}\n• Delivery fee: ${currency} ${config.business.deliveryFee}\n• Delivery time: ${config.business.deliveryTime}\n\nOrder karne ke liye item ka naam likhein (e.g. "1 chicken biryani").`
      );
    }
    if (route?.kind === "DELIVERY_ETA") {
      return finish(`Delivery taqreeban ${config.business.deliveryTime} mein ho jati hai.`);
    }
    if (route?.kind === "ORDER_STATUS") {
      if (draft) {
        return finish(`Aapka order abhi in-progress hai.\n\n${draftReprompt(draft, config)}`);
      }
      if (route.orderId) {
        const order = await getOrderById(phoneNumberId, route.orderId);
        if (order) {
          return finish(
            `Aapka order #${order.id} record mein maujood hai.\n\nItems:\n${order.items
              .map((i) => `• ${i.qty}x ${i.name}`)
              .join("\n")}\n\nTotal: ${currency} ${order.total}\nDelivery address: ${order.address}\nDelivery time: ${config.business.deliveryTime}.`
          );
        }
        return finish(
          `Order ID "${route.orderId}" hamare system mein nahi mila. Meharbani karke sahi Order ID check karein.`
        );
      }
      const latest = await getLatestOrderForUser(phoneNumberId, userPhone);
      if (latest) {
        return finish(
          `Aapka aakhri order #${latest.id} record mein maujood hai.\n\nItems:\n${latest.items
            .map((i) => `• ${i.qty}x ${i.name}`)
            .join("\n")}\n\nTotal: ${currency} ${latest.total}\nDelivery address: ${latest.address}\nDelivery time: ${config.business.deliveryTime}.`
        );
      }
      return finish(`Aapka koi recent order record mein nahi mila. Agar aapke paas Order ID hai to bhejein (e.g. "ORD-XXXX").`);
    }

    const intent = route?.kind === "intent" ? route.intent : await classifyIntent(userMessage, history, menu);
    if (!intent || intent.intent === "UNKNOWN") {
      if (draft) return finish(draftReprompt(draft, config));
      return finish(
        `Maaf kijiye, main sirf ${config.business.name} ke menu, prices, delivery aur orders ke baray mein madad kar sakta hoon.\n\n"menu" likhein ya order ke liye item ka naam bhejein.`
      );
    }

    if (intent.intent === "MENU") return finish(`${menuText}\n\n💬 Order karne ke liye item name likhein.`);
    if (intent.intent === "GREETING") return finish(buildGreetingResponse(config));
    if (intent.intent === "THANKS") return finish(`Aap ka shukriya! 🙏\n${config.business.name} mein dobara aayein!`);
    if (intent.intent === "COMPLAINT")
      return finish(`Maaf kijiye, hamare prices fixed hain.\n\nMenu dekhein: "menu" likhein.`);
    if (intent.intent === "CONFIRM") {
      if (draft) return finish(draftReprompt(draft, config));
      return finish('Abhi koi pending order nahi hai.\n\nPehle order dein, e.g. "1 chicken biryani".');
    }
    if (intent.intent === "CANCEL") {
      if (draft) {
        await clearOrderDraft(phoneNumberId, userPhone);
        return finish('Order cancel ho gaya.\n\nAur kuch help chahiye? "menu" likhein.');
      }
      return finish("Cancel karne ke liye pehle koi active order hona chahiye.");
    }
    if (intent.intent === "ITEM_CHECK" || intent.intent === "PRICE_QUERY") {
      const requested = intent.items[0]?.name;
      if (!requested) return finish(`Kaunsa item check karna hai? Item ka naam likhein.\n\n${menuText}`);
      const found = findMenuItem(requested, menu);
      if (!found) return finish(formatItemNotAvailable(requested, menu));
      if (intent.intent === "ITEM_CHECK") {
        return finish(
          `✅ Haan! *${found}* available hai.\nPrice: ${currency} ${menu[found]}\n\nOrder karne ke liye "1 ${found}" likhein.`
        );
      }
      return finish(`*${found}*: ${currency} ${menu[found]}\n\nOrder karna ho to "1 ${found}" likhein.`);
    }
    if (intent.intent === "ORDER") {
      const orderItems = intent.items;
      if (!orderItems.length)
        return finish('Kya order karna hai? Item ka naam likhein, e.g. "1 chicken biryani".');
      if (!isRestaurantOpen(config.business.hours, config.business.timezone ?? "Asia/Karachi"))
        return finish(closedMessage(config.business.name, config.business.hours));
      const resolved = toPersistedItems(orderItems, menu);
      if (!Array.isArray(resolved)) return finish(formatItemNotAvailable(resolved.itemName, menu));
      if (resolved.length === 1) {
        await saveOrderDraft(
          phoneNumberId,
          userPhone,
          makeDraft("AWAITING_QUANTITY", resolved, config.business.deliveryFee)
        );
        return finish(promptForQuantity(resolved[0]));
      }
      const nextDraft = makeDraft("AWAITING_ADDRESS", resolved, config.business.deliveryFee);
      if (nextDraft.subtotal < config.business.minimumOrder)
        return finish(
          minimumOrderMessage(
            config.business.minimumOrder - nextDraft.subtotal,
            config.business.minimumOrder,
            currency
          )
        );
      await saveOrderDraft(phoneNumberId, userPhone, nextDraft);
      return finish(formatAddressPrompt(config));
    }

    if (draft) return finish(draftReprompt(draft, config));
    if (intent.intent === "ADDRESS")
      return finish('Pehle apna order dein (e.g. "1 chicken biryani"), phir hum address mangenge.');
    return finish(
      `Maaf kijiye, main sirf ${config.business.name} ke menu, prices, delivery aur orders ke baray mein madad kar sakta hoon.\n\n"menu" likhein ya order ke liye item ka naam bhejein.`
    );
  } catch (error) {
    console.error("[agent] unexpected_response_failure", {
      error,
      stack: error instanceof Error ? error.stack : undefined,
      phoneNumberId,
      userPhone,
      userMessage,
    });
    return finish("⚠️ Technical issue hai. Thori dair baad try karein.");
  }
}
