import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  wake: vi.fn(),
  handler: vi.fn(() => ({ ok: true })),
}));
vi.mock("../transport", () => ({ wakeTogether: mocks.wake }));
vi.mock("../togetherRoutes", async () => {
  const { default: Elysia } = await import("elysia");
  return {
    togetherRoutes: new Elysia()
      .get("/together/sessions", mocks.handler)
      .post("/together/sessions", mocks.handler),
  };
});
vi.mock("../../social/socialHandler", async () => {
  const { default: Elysia } = await import("elysia");
  return {
    socialHandler: new Elysia()
      .get("/social/friends", mocks.handler)
      .post("/social/friends", mocks.handler),
  };
});
vi.mock("../../places/placesHandler", async () => {
  const { default: Elysia } = await import("elysia");
  return { placesHandler: new Elysia().get("/places/search", mocks.handler) };
});
vi.mock("../templatesHandler", async () => {
  const { default: Elysia } = await import("elysia");
  return {
    templatesHandler: new Elysia()
      .get("/together/templates", mocks.handler)
      .post("/together/templates", mocks.handler),
  };
});
import { togetherFeatureRoutes } from "../featureRoutes";
const app = new Hono().get("/before", (c) => c.text("before"));
for (const prefix of ["/together/*", "/social/*", "/places/*"])
  app.all(prefix, (c) => togetherFeatureRoutes.fetch(c.req.raw));
app.get("/after", (c) => c.text("after"));
const request = (path: string, method = "GET") =>
  app.fetch(new Request(`http://localhost${path}`, { method }));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});
describe("Together feature mounting", () => {
  it("disables every Together route before its handler without disabling existing API routes", async () => {
    vi.stubEnv("TOGETHER_ENABLED", "");
    for (const path of [
      "/together/sessions",
      "/social/friends",
      "/places/search",
      "/together/templates",
    ]) {
      const response = await request(path);
      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        error: { code: "NOT_FOUND" },
      });
    }
    expect(mocks.handler).not.toHaveBeenCalled();
    expect(await (await request("/before")).text()).toBe("before");
    expect(await (await request("/after")).text()).toBe("after");
  });
  it("mounts all enabled handlers and wakes only social/template mutations", async () => {
    vi.stubEnv("TOGETHER_ENABLED", "true");
    for (const path of [
      "/together/sessions",
      "/social/friends",
      "/places/search",
      "/together/templates",
    ])
      expect((await request(path)).status).toBe(200);
    expect(mocks.wake).not.toHaveBeenCalled();
    await request("/together/sessions", "POST");
    expect(mocks.wake).not.toHaveBeenCalled();
    await request("/social/friends", "POST");
    await request("/together/templates", "POST");
    expect(mocks.wake).toHaveBeenCalledTimes(2);
  });
});
