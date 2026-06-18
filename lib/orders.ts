import { getRedis } from './redis';
import config from '@/config.json';

export type OrderItem = {
  name: string;
  qty: number;
  price: number;
  lineTotal: number;
};

type PendingOrder = {
  items: OrderItem[];
  subtotal: number;
  total: number;
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
};

function generateOrderId(): string {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `ORD-${date}-${rand}`;
}

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function savePendingOrder(
  phone: string,
  items: OrderItem[],
  subtotal: number,
  total: number
): Promise<void> {
  const redis = getRedis();
  const pending: PendingOrder = { items, subtotal, total };
  await redis.setex(`pending:${phone}`, 3600, pending);
}

export async function confirmOrder(
  phone: string,
  address: string
): Promise<Order | null> {
  const redis = getRedis();
  const pending = await redis.get<PendingOrder>(`pending:${phone}`);
  if (!pending) return null;

  const order: Order = {
    id: generateOrderId(),
    phone,
    items: pending.items,
    subtotal: pending.subtotal,
    deliveryFee: config.business.deliveryFee,
    total: pending.total,
    address,
    timestamp: new Date().toISOString(),
  };

  const key = todayKey();
  await Promise.all([
    redis.set(`order:${order.id}`, order),
    redis.rpush(`orders:${key}`, order.id),
    redis.del(`pending:${phone}`),
  ]);

  return order;
}

export async function getTodaysOrders(): Promise<Order[]> {
  const redis = getRedis();
  const key = todayKey();
  const ids = await redis.lrange<string>(`orders:${key}`, 0, -1);
  if (!ids.length) return [];

  const orders = await Promise.all(
    ids.map((id) => redis.get<Order>(`order:${id}`))
  );

  return orders.filter((o): o is Order => o !== null);
}
