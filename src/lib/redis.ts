import Redis from "ioredis";
let client: Redis | null = null;
export function getRedis() {
  if (client !== null) return client;
  const url = process.env.REDIS_URL;
  client = url ? new Redis(url, { enableOfflineQueue:false }) : null;
  return client;
}
