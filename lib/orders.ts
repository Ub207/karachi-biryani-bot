import { randomUUID } from "crypto";
import { getRedis } from "./redis";

export type OrderItem = {
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
};

export type OrderDraftPhase =
  | "AWAITING_QUANTITY"
  | "AWAITING_ADDRESS"
  | "AWAITING_CONFIRMATION";

export type OrderDraft = {
  phase: OrderDraftPhase;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  address?: string;
  confirmation: "NOT_ASKED" | "PENDING";
  createdAt: string;
  updatedAt: string;
};

export type Order = {
  id: string;
  phone: string;
  items: OrderItem[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  address: string;
  timestamp: string;
  confirmedAt: string;
};

type ExpiringValue<T> = { value: T; expiresAt: number };

const DRAFT_TTL_SECONDS = 2 * 60 * 60;
const RECEIPT_TTL_SECONDS = 24 * 60 * 60;
const inMemoryDrafts = new Map<string, ExpiringValue<OrderDraft>>();
const inMemoryOrders = new Map<string, Order>();
const inMemoryReceipts = new Map<string, ExpiringValue<Order>>();

function encodePart(value: string): string {
  return encodeURIComponent(value);
}

function draftKey(phoneNumberId: string, phone: string): string {
  return `order-draft:v1:${encodePart(phoneNumberId)}:${encodePart(phone)}`;
}

function receiptKey(phoneNumberId: string, phone: string): string {
  return `order-receipt:v1:${encodePart(phoneNumberId)}:${encodePart(phone)}`;
}

function orderKey(phoneNumberId: string, orderId: string): string {
  return `order:${encodePart(phoneNumberId)}:${orderId}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function memoryGet<T>(store: Map<string, ExpiringValue<T>>, key: string): T | null {
  const entry = store.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    store.delete(key);
    return null;
  }
  return entry.value;
}

function memorySet<T>(store: Map<string, ExpiringValue<T>>, key: string, value: T, ttlSeconds: number) {
  store.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

export async function getOrderDraft(phoneNumberId: string, phone: string): Promise<OrderDraft | null> {
  const key = draftKey(phoneNumberId, phone);
  const fallback = memoryGet(inMemoryDrafts, key);
  try {
    const redis = getRedis();
    if (!redis) return fallback;
    const draft = await redis.get<OrderDraft>(key);
    if (draft) memorySet(inMemoryDrafts, key, draft, DRAFT_TTL_SECONDS);
    return draft ?? fallback;
  } catch (error) {
    console.warn("[orders] draft_read_degraded", { error });
    return fallback;
  }
}

export async function saveOrderDraft(phoneNumberId: string, phone: string, draft: OrderDraft): Promise<void> {
  const key = draftKey(phoneNumberId, phone);
  memorySet(inMemoryDrafts, key, draft, DRAFT_TTL_SECONDS);
  try {
    const redis = getRedis();
    if (redis) await redis.setex(key, DRAFT_TTL_SECONDS, draft);
  } catch (error) {
    console.warn("[orders] draft_write_degraded", { error });
  }
}

export async function clearOrderDraft(phoneNumberId: string, phone: string): Promise<void> {
  const key = draftKey(phoneNumberId, phone);
  inMemoryDrafts.delete(key);
  try {
    const redis = getRedis();
    if (redis) await redis.del(key);
  } catch (error) {
    console.warn("[orders] draft_clear_degraded", { error });
  }
}

export async function finalizeOrderDraft(phoneNumberId: string, phone: string): Promise<Order | null> {
  const receipt = receiptKey(phoneNumberId, phone);
  const remembered = memoryGet(inMemoryReceipts, receipt);
  if (remembered) return remembered;

  try {
    const redis = getRedis();
    if (redis) {
      const stored = await redis.get<Order>(receipt);
      if (stored) return stored;
    }
  } catch (error) {
    console.warn("[orders] receipt_read_degraded", { error });
  }

  const draft = await getOrderDraft(phoneNumberId, phone);
  if (!draft || draft.phase !== "AWAITING_CONFIRMATION" || !draft.address) return null;

  const confirmedAt = new Date().toISOString();
  const order: Order = {
    id: `ORD-${randomUUID().replace(/-/g, "").slice(0, 12).toUpperCase()}`,
    phone,
    items: draft.items,
    subtotal: draft.subtotal,
    deliveryFee: draft.deliveryFee,
    total: draft.total,
    address: draft.address,
    timestamp: draft.createdAt,
    confirmedAt,
  };
  const orderStorageKey = orderKey(phoneNumberId, order.id);
  inMemoryOrders.set(orderStorageKey, order);
  memorySet(inMemoryReceipts, receipt, order, RECEIPT_TTL_SECONDS);
  inMemoryDrafts.delete(draftKey(phoneNumberId, phone));

  try {
    const redis = getRedis();
    if (redis) {
      await Promise.all([
        redis.set(orderStorageKey, order),
        redis.rpush(`orders:${encodePart(phoneNumberId)}:${todayKey()}`, order.id),
        redis.setex(receipt, RECEIPT_TTL_SECONDS, order),
        redis.del(draftKey(phoneNumberId, phone)),
      ]);
    }
  } catch (error) {
    console.warn("[orders] finalize_degraded", { error });
  }
  return order;
}

export async function getLatestOrderForUser(phoneNumberId: string, phone: string): Promise<Order | null> {
  const receipt = receiptKey(phoneNumberId, phone);
  const remembered = memoryGet(inMemoryReceipts, receipt);
  if (remembered) return remembered;
  try {
    const redis = getRedis();
    if (redis) {
      const stored = await redis.get<Order>(receipt);
      if (stored) {
        memorySet(inMemoryReceipts, receipt, stored, RECEIPT_TTL_SECONDS);
        return stored;
      }
    }
  } catch (error) {
    console.warn("[orders] latest_order_read_degraded", { error });
  }
  return null;
}

export async function getOrderById(phoneNumberId: string, orderId: string): Promise<Order | null> {
  const cleanId = orderId.trim().toUpperCase();
  const orderStorageKey = orderKey(phoneNumberId, cleanId);
  const inMem = inMemoryOrders.get(orderStorageKey);
  if (inMem) return inMem;
  try {
    const redis = getRedis();
    if (redis) {
      const stored = await redis.get<Order>(orderStorageKey);
      if (stored) {
        inMemoryOrders.set(orderStorageKey, stored);
        return stored;
      }
    }
  } catch (error) {
    console.warn("[orders] get_order_by_id_degraded", { error });
  }
  return null;
}

export async function getTodaysOrders(phoneNumberId: string): Promise<Order[]> {
  const tenantPrefix = `order:${encodePart(phoneNumberId)}:`;
  const redis = getRedis();
  if (!redis) return Array.from(inMemoryOrders.entries())
    .filter(([key]) => key.startsWith(tenantPrefix))
    .map(([, order]) => order);
  const ids = await redis.lrange<string>(`orders:${encodePart(phoneNumberId)}:${todayKey()}`, 0, -1);
  const orders = await Promise.all(ids.map((id) => redis.get<Order>(orderKey(phoneNumberId, id))));
  return orders.filter((order): order is Order => order !== null);
}

export function __resetOrderStorageForTests(): void {
  inMemoryDrafts.clear();
  inMemoryOrders.clear();
  inMemoryReceipts.clear();
}

