import { getRedis } from './redis';

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
  phoneNumberId: string,
  phone: string,
  items: OrderItem[],
  subtotal: number,
  total: number
): Promise<void> {
  console.log(`[orders] savePendingOrder: client=${phoneNumberId} phone=${phone} items=${items.length} total=${total}`);
  const redis = getRedis();
  const pending: PendingOrder = { items, subtotal, total };
  try {
    const result = await redis.setex(`pending:${phoneNumberId}:${phone}`, 3600, pending);
    console.log(`[orders] savePendingOrder: setex result=${JSON.stringify(result)}`);
  } catch (err) {
    console.error(`[orders] savePendingOrder FAILED client=${phoneNumberId} phone=${phone}:`, err);
    throw err;
  }
}

export async function confirmOrder(
  phoneNumberId: string,
  phone: string,
  address: string,
  deliveryFee: number
): Promise<Order | null> {
  console.log(`[orders] confirmOrder: client=${phoneNumberId} phone=${phone}`);
  const redis = getRedis();

  let pending: PendingOrder | null;
  try {
    pending = await redis.get<PendingOrder>(`pending:${phoneNumberId}:${phone}`);
    console.log(`[orders] confirmOrder: pending=${pending ? 'found' : 'null'}`);
  } catch (err) {
    console.error(`[orders] confirmOrder FAILED reading pending order client=${phoneNumberId} phone=${phone}:`, err);
    throw err;
  }

  if (!pending) {
    console.warn(`[orders] confirmOrder: no pending order for client=${phoneNumberId} phone=${phone}`);
    return null;
  }

  const order: Order = {
    id: generateOrderId(),
    phone,
    items: pending.items,
    subtotal: pending.subtotal,
    deliveryFee,
    total: pending.total,
    address,
    timestamp: new Date().toISOString(),
  };

  const key = todayKey();
  try {
    await Promise.all([
      redis.set(`order:${phoneNumberId}:${order.id}`, order),
      redis.rpush(`orders:${phoneNumberId}:${key}`, order.id),
      redis.del(`pending:${phoneNumberId}:${phone}`),
    ]);
    console.log(`[orders] confirmOrder: saved id=${order.id} list=orders:${phoneNumberId}:${key}`);
  } catch (err) {
    console.error(`[orders] confirmOrder FAILED saving order id=${order.id}:`, err);
    throw err;
  }

  return order;
}

export async function getTodaysOrders(phoneNumberId: string): Promise<Order[]> {
  const redis = getRedis();
  const key = todayKey();
  const ids = await redis.lrange<string>(`orders:${phoneNumberId}:${key}`, 0, -1);
  if (!ids.length) return [];

  const orders = await Promise.all(
    ids.map((id) => redis.get<Order>(`order:${phoneNumberId}:${id}`))
  );

  return orders.filter((o): o is Order => o !== null);
}
