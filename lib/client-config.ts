import { getRedis } from './redis';
import defaultConfig from '@/config.json';

export type MenuItem = { id?: string; name: string; price: number };
export type MenuCategory = { category: string; items: MenuItem[] };

export type ClientConfig = {
  phoneNumberId: string;
  whatsappToken: string;
  business: {
    name: string;
    address: string;
    hours: string;
    phone: string;
    deliveryAreas: string[];
    minimumOrder: number;
    deliveryFee: number;
    deliveryTime: string;
    currency: string;
    language?: string;
  };
  menu: MenuCategory[];
  responses?: Partial<{
    greeting: string;
    noOrderFound: string;
  }>;
};

export function buildFlatMenu(config: ClientConfig): Record<string, number> {
  const flat: Record<string, number> = {};
  for (const cat of config.menu) {
    for (const item of cat.items) {
      flat[item.name] = item.price;
    }
  }
  return flat;
}

export function buildMenuText(config: ClientConfig): string {
  const { business, menu } = config;
  const cur = business.currency;
  let text = `📋 *${business.name} Menu*\n\n`;
  for (const cat of menu) {
    text += `*${cat.category}:*\n`;
    for (const item of cat.items) {
      text += `• ${item.name} - ${cur} ${item.price}\n`;
    }
    text += '\n';
  }
  text += `_Min order: ${cur} ${business.minimumOrder}_\n`;
  text += `_Delivery: ${cur} ${business.deliveryFee} (${business.deliveryTime})_`;
  return text;
}

export async function getClientConfig(phoneNumberId: string): Promise<ClientConfig> {
  try {
    const redis = getRedis();
    const stored = await redis.get<ClientConfig>(`config:${phoneNumberId}`);
    if (stored) {
      console.log(`[client-config] Loaded Redis config for ${phoneNumberId}`);
      return stored;
    }
  } catch (err) {
    console.error(`[client-config] Redis lookup failed for ${phoneNumberId}:`, err);
  }
  console.log(`[client-config] Using default config.json for ${phoneNumberId}`);
  return {
    phoneNumberId,
    whatsappToken: process.env.WHATSAPP_TOKEN ?? '',
    business: { ...defaultConfig.business, currency: 'Rs.' },
    menu: defaultConfig.menu,
  };
}
