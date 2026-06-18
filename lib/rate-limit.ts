import { getRedis } from './redis';

const WINDOW_SECONDS = 3600; // 1 hour
const MAX_MESSAGES = 20;

export async function checkRateLimit(
  phoneNumberId: string,
  phone: string
): Promise<{ allowed: boolean }> {
  const redis = getRedis();
  const window = Math.floor(Date.now() / (WINDOW_SECONDS * 1000));
  const key = `ratelimit:${phoneNumberId}:${phone}:${window}`;

  try {
    const count = await redis.incr(key);
    if (count === 1) {
      // Set expiry on first message of the window; +60s buffer avoids
      // a near-boundary key living past its logical window end.
      await redis.expire(key, WINDOW_SECONDS + 60);
    }
    return { allowed: count <= MAX_MESSAGES };
  } catch (err) {
    // Fail open: never block a user because Redis is unavailable.
    console.error('[rate-limit] Redis error, allowing request:', err);
    return { allowed: true };
  }
}
