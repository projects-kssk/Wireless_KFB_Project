// src/lib/redis.ts
import Redis from "ioredis";

let client: Redis | null = null;

export function getRedis() {
  if (!process.env.REDIS_URL) return null;
  if (!client) {
    client = new Redis(process.env.REDIS_URL, {
      lazyConnect: false,          // connect immediately
      enableOfflineQueue: true,    // avoids "Stream isn't writeable"
      maxRetriesPerRequest: null,
    });
  }
  return client;
}
