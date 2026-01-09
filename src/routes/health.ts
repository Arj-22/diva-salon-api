import { Hono } from "hono";
import { get } from "http";
import { getRedisClient } from "../lib/redisClient.js";

const app = new Hono();

app.get("/", async (c) => {
  // try {
  //   // const pong = await redis.ping();
  //   const redis = await getRedisClient();
  //   if (!redis) {
  //     return c.json({ ok: true, redis: false });
  //   }
  //   const pong = await redis.ping();
  //   return c.json({ ok: true, redis: pong === "PONG" });
  // } catch (e) {
  //   return c.json({ ok: true, redis: false, error: (e as Error).message }, 200);
  // }

  return c.json({ ok: true });
});

export default app;
