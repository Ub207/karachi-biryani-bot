import { NextRequest, NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";
import { ClientConfig, MenuCategory } from "@/lib/client-config";

export const dynamic = "force-dynamic";

function err(msg: string, status = 400) {
  return NextResponse.json({ error: msg }, { status });
}

export async function POST(request: NextRequest) {
  // Require Bearer token matching ADMIN_PASSWORD
  const auth = request.headers.get("authorization");
  if (!auth || auth !== `Bearer ${process.env.ADMIN_PASSWORD}`) {
    return err("Unauthorized", 401);
  }

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return err("Invalid JSON body");
  }

  const phone_number_id = body.phone_number_id;
  const whatsapp_token = body.whatsapp_token;
  const business = (body.business ?? null) as Record<string, unknown> | null;
  const menu = (body.menu ?? null) as MenuCategory[] | null;

  if (!phone_number_id || typeof phone_number_id !== "string") {
    return err("phone_number_id is required");
  }
  if (!whatsapp_token || typeof whatsapp_token !== "string") {
    return err("whatsapp_token is required");
  }
  if (!business || typeof business !== "object" || Array.isArray(business)) {
    return err("business config is required");
  }

  const requiredBusinessFields = [
    "name", "address", "hours", "phone",
    "deliveryAreas", "minimumOrder", "deliveryFee", "deliveryTime",
  ] as const;
  for (const field of requiredBusinessFields) {
    if (business[field] === undefined || business[field] === null) {
      return err(`business.${field} is required`);
    }
  }

  if (!Array.isArray(menu) || menu.length === 0) {
    return err("menu must be a non-empty array of categories");
  }
  for (const cat of menu) {
    if (!cat.category || !Array.isArray(cat.items) || cat.items.length === 0) {
      return err("Each menu entry needs a category string and a non-empty items array");
    }
    for (const item of cat.items) {
      if (!item.name || typeof item.price !== "number") {
        return err("Each menu item needs a name (string) and price (number)");
      }
    }
  }

  const config: ClientConfig = {
    phoneNumberId: phone_number_id as string,
    whatsappToken: whatsapp_token as string,
    business: {
      name: String(business.name),
      address: String(business.address),
      hours: String(business.hours),
      phone: String(business.phone),
      deliveryAreas: Array.isArray(business.deliveryAreas) ? (business.deliveryAreas as string[]) : [],
      minimumOrder: Number(business.minimumOrder),
      deliveryFee: Number(business.deliveryFee),
      deliveryTime: String(business.deliveryTime),
      currency: typeof business.currency === "string" ? business.currency : "Rs.",
      language: typeof business.language === "string" ? business.language : undefined,
    },
    menu,
    responses: (body.responses as ClientConfig["responses"]) ?? undefined,
  };

  try {
    const redis = getRedis();
    if (!redis) {
      return err("Upstash Redis is not configured", 500);
    }
    await redis.set(`config:${phone_number_id}`, config);
    console.log(`[setup-client] Saved config for phone_number_id=${phone_number_id}`);
  } catch (redisErr) {
    console.error("[setup-client] Redis write failed:", redisErr);
    return err("Failed to save config to Redis", 500);
  }

  return NextResponse.json({
    ok: true,
    phone_number_id,
    business_name: config.business.name,
    menu_items: menu.reduce((n: number, c: { items: unknown[] }) => n + c.items.length, 0),
  });
}
