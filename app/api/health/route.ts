// app/api/health/route.ts
import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const timestamp = new Date().toISOString();

  // 1. Webhook Status
  const webhook = {
    status: process.env.WHATSAPP_VERIFY_TOKEN ? "healthy" : "unhealthy",
    verifyTokenConfigured: Boolean(process.env.WHATSAPP_VERIFY_TOKEN),
    appSecretConfigured: Boolean(process.env.WHATSAPP_APP_SECRET),
    signatureVerification: Boolean(process.env.WHATSAPP_APP_SECRET?.trim()) ? "enforced" : "permissive",
  };

  // 2. Redis Status
  const redisStatus: {
    status: "healthy" | "degraded" | "unhealthy";
    connected: boolean;
    configured: boolean;
    error?: string;
  } = {
    status: "unhealthy",
    connected: false,
    configured: Boolean(process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN),
  };

  try {
    const redis = getRedis();
    if (redis) {
      const ping = await redis.ping();
      redisStatus.connected = ping === "PONG" || ping === "OK" || Boolean(ping);
      redisStatus.status = "healthy";
    } else {
      redisStatus.status = "degraded";
      redisStatus.error = "Upstash credentials not configured, in-memory fallback active";
    }
  } catch (err: unknown) {
    redisStatus.status = "degraded";
    redisStatus.error = err instanceof Error ? err.message : String(err);
  }

  // 3. AI Status (Groq)
  const ai = {
    status: process.env.GROQ_API_KEY ? "healthy" : "degraded",
    apiKeyConfigured: Boolean(process.env.GROQ_API_KEY),
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  };

  // 4. WhatsApp API Status
  const whatsapp = {
    status: (process.env.WHATSAPP_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID) ? "healthy" : "degraded",
    tokenConfigured: Boolean(process.env.WHATSAPP_TOKEN),
    phoneNumberIdConfigured: Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID),
  };

  const isHealthy = webhook.status === "healthy" && (whatsapp.status === "healthy" || Boolean(process.env.WHATSAPP_TOKEN));

  return NextResponse.json(
    {
      status: isHealthy ? "ok" : "degraded",
      timestamp,
      services: {
        webhook,
        redis: redisStatus,
        ai,
        whatsapp,
      },
    },
    { status: 200 }
  );
}
