import { createClient } from "redis";
import { config } from "dotenv";
import { URL } from "node:url";

config();

function resolveRedisUrl(): string {
  const raw = process.env.REDIS_URL?.trim();
  if (!raw || raw === "") return "redis://localhost:6379";
  return raw;
}

let redisClient: ReturnType<typeof createClient> | null = null;

async function tryConnect(url: string) {
  const client = createClient({
    url,
    socket: {
      reconnectStrategy: (retries) => Math.min(retries * 50, 1000),
    },
  });

  client.on("error", (err) => {
    console.error("Redis Client Error:", err);
  });
  client.on("connect", () => console.log("Redis Client Connected"));
  client.on("ready", () => console.log("Redis Client Ready"));
  client.on("end", () => console.log("Redis Client Disconnected"));

  try {
    await client.connect();
    return client;
  } catch (e: any) {
    await client.quit().catch(() => {});
    throw e;
  }
}

export async function getRedisClient() {
  if (redisClient) return redisClient;

  const initialUrl = resolveRedisUrl();
  try {
    redisClient = await tryConnect(initialUrl);
  } catch (e: any) {
    if (e?.code === "ENOTFOUND") {
      const host = new URL(initialUrl).hostname;
      if (host === "redis") {
        const fallbackUrl = "redis://localhost:6379";
        console.warn(
          `Host '${host}' unreachable; retrying Redis with '${fallbackUrl}'`
        );
        try {
          redisClient = await tryConnect(fallbackUrl);
        } catch (inner) {
          console.error("Fallback Redis connection failed:", inner);
          redisClient = null;
        }
      } else {
        console.error("Redis DNS lookup failed:", e);
        redisClient = null;
      }
    } else {
      console.error("Redis connection failed:", e);
      redisClient = null;
    }
  }

  return redisClient;
}

export async function closeRedisConnection() {
  if (redisClient) {
    await redisClient.quit().catch(() => {});
    redisClient = null;
  }
}

// Cache helper (unchanged below)
export class CacheManager {
  private client: ReturnType<typeof createClient> | null = null;

  constructor() {
    this.init();
  }
  private async init() {
    this.client = await getRedisClient();
  }
  async get(key: string): Promise<any> {
    try {
      if (!this.client) this.client = await getRedisClient();
      if (!this.client) return null;
      const value = await this.client.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error("Cache get error:", error);
      return null;
    }
  }
  async set(
    key: string,
    value: any,
    ttlSeconds: number = 300
  ): Promise<boolean> {
    try {
      if (!this.client) this.client = await getRedisClient();
      if (!this.client) return false;
      await this.client.setEx(key, ttlSeconds, JSON.stringify(value));
      return true;
    } catch (error) {
      console.error("Cache set error:", error);
      return false;
    }
  }
  async del(key: string): Promise<boolean> {
    try {
      if (!this.client) this.client = await getRedisClient();
      if (!this.client) return false;
      await this.client.del(key);
      return true;
    } catch (error) {
      console.error("Cache del error:", error);
      return false;
    }
  }
  async invalidatePattern(pattern: string): Promise<boolean> {
    try {
      if (!this.client) this.client = await getRedisClient();
      if (!this.client) return false;
      const keys = await this.client.keys(pattern);
      if (keys.length) await this.client.del(keys);
      return true;
    } catch (error) {
      console.error("Cache invalidatePattern error:", error);
      return false;
    }
  }
}

export const cache = new CacheManager();
