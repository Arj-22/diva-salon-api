import { Hono } from "hono";
import pkg from "../../package.json" with { type: "json" };
const app = new Hono();
app.get("/", async (c) => {
    return c.json({ ok: true, version: pkg.version });
});
export default app;
