import { NextResponse } from "next/server";
import { getRedis } from "@/lib/redis";

export const dynamic = "force-dynamic";

export async function GET() {
  const results: Record<string, string> = {};

  results.UPSTASH_REDIS_REST_URL = process.env.UPSTASH_REDIS_REST_URL
    ? `set (${process.env.UPSTASH_REDIS_REST_URL.slice(0, 30)}...)`
    : "MISSING";
  results.UPSTASH_REDIS_REST_TOKEN = process.env.UPSTASH_REDIS_REST_TOKEN
    ? `set (${process.env.UPSTASH_REDIS_REST_TOKEN.length} chars)`
    : "MISSING";

  try {
    const redis = getRedis();

    const pingResult = await redis.ping();
    results.ping = String(pingResult);

    await redis.set("__redis_test__", "ok", { ex: 30 });
    results.set = "ok";

    const val = await redis.get("__redis_test__");
    results.get = val === "ok" ? "ok" : `unexpected value: ${val}`;

    await redis.del("__redis_test__");
    results.del = "ok";

    return NextResponse.json({ status: "ok", results });
  } catch (err: any) {
    results.error = err?.message || String(err);
    return NextResponse.json({ status: "error", results }, { status: 500 });
  }
}
