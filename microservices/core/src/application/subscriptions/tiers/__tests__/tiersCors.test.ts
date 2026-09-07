import { describe, expect, it, vi } from "vitest";
import Elysia from "elysia";

/**
 * CORS on the two public reads the WEBSITE makes.
 *
 * `infra/api.ts` sets `cors: false`, so API Gateway no longer injects
 * `Access-Control-Allow-Origin` on the way out. Neither of these is a
 * "complex" request — a GET with no custom headers is never preflighted — but
 * the browser still refuses to let the page READ a cross-origin response with
 * no allow-origin header. So without these the pricing table and the founding
 * counter render empty with only a console message, on the public site.
 */

const listActive = vi.hoisted(() => vi.fn());
vi.mock("../../../repositories/subscriptionTiersRepository", () => ({
  SubscriptionTiersRepository: class {
    listActive = listActive;
  },
}));
vi.mock("../../../repositories/foundingGrantRepository", () => ({
  FoundingGrantRepository: class {
    seatsForPool = vi.fn(async (pool: string) => ({ pool, used: 1, cap: 200 }));
  },
}));
vi.mock("../../../repositories/foundingCheckoutRepository", () => ({
  FoundingCheckoutRepository: class {
    countHeldInPool = vi.fn(async () => 0);
  },
}));
vi.mock("@persistence/db/client", () => ({ getDb: vi.fn() }));

import { subscriptionsTiersHandler } from "../subscriptionsTiersHandler";

const app = new Elysia().use(subscriptionsTiersHandler);
const get = (path: string) =>
  app.handle(
    new Request(`http://localhost${path}`, {
      headers: { origin: "https://persistence.evans-software-solutions.com" },
    }),
  );

describe.each(["/subscription-tiers", "/founding/availability"])(
  "%s",
  (path) => {
    it("lets a cross-origin page read the response", async () => {
      listActive.mockResolvedValue([]);
      const res = await get(path);
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
    });

    it("answers a preflight, in case a client sends one", async () => {
      const res = await app.handle(
        new Request(`http://localhost${path}`, { method: "OPTIONS" }),
      );
      expect(res.status).toBe(204);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toContain("GET");
    });
  },
);

describe("the public policy", () => {
  it("is `*`, unlike the admin policy", async () => {
    // Deliberate and worth pinning: these routes carry no credential, so
    // there is no session for another origin to ride. `/admin/*` echoes one
    // origin precisely because those routes do.
    listActive.mockResolvedValue([]);
    const res = await get("/subscription-tiers");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-credentials")).toBeNull();
  });
});
