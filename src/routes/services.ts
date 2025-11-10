import { Hono } from "hono";

const services = new Hono();

services.get("/", (c) => {
  return c.text("Services Service is running and watching.");
});

export default services;
