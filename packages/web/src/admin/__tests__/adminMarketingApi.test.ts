import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { adminApi } from "../adminApi";
import { saveSession, sessionFromTokens } from "../adminAuth";

/**
 * The marketing calls are a hand-kept mirror of the handlers in
 * `microservices/core/src/application/admin/marketing` — `treaty<CoreApi>`
 * cannot be used here (TS2589), so nothing type-checks the path or the verb.
 *
 * A wrong verb or a mistyped segment is invisible in the pages' tests, which
 * mock this module wholesale. This drives the real wrappers through a stubbed
 * `fetch` and asserts the request each one actually makes.
 */

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, "");
  return `${b64({ alg: "HS256" })}.${b64(payload)}.sig`;
}

let fetchMock: ReturnType<typeof vi.fn>;

function lastRequest(): { url: string; method: string; body: unknown } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return {
    url,
    method: init.method ?? "GET",
    body: init.body ? JSON.parse(init.body as string) : undefined,
  };
}

describe("the /admin/marketing API wrappers", () => {
  beforeEach(() => {
    saveSession(
      sessionFromTokens(
        jwt({
          exp: Math.floor(Date.now() / 1000) + 3600,
          app_metadata: { admin: true },
        }),
        "rt",
      ),
    );
    fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ data: { slugs: ["meta"] } }), {
          status: 200,
        }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    saveSession(null);
    vi.unstubAllGlobals();
  });

  it("unwraps the campaign slugs to a bare array", async () => {
    expect(await adminApi.campaignSlugs()).toEqual(["meta"]);
    expect(lastRequest().url).toContain("/admin/marketing/campaign-slugs");
  });

  it("omits the status filter when none is given", async () => {
    await adminApi.marketingPlans();
    expect(lastRequest().url).toMatch(/\/admin\/marketing\/plans$/);
  });

  it("passes the status filter through", async () => {
    await adminApi.marketingPlans("paused");
    expect(lastRequest().url).toMatch(/\/plans\?status=paused$/);
  });

  it.each([
    [
      "marketingPlan",
      () => adminApi.marketingPlan("p1"),
      "GET",
      "/admin/marketing/plans/p1",
    ],
    [
      "createMarketingPlan",
      () =>
        adminApi.createMarketingPlan({
          name: "x",
          slug: "x",
          offerLanes: [],
        }),
      "POST",
      "/admin/marketing/plans",
    ],
    [
      "updateMarketingPlan",
      () => adminApi.updateMarketingPlan("p1", { status: "active" }),
      "PATCH",
      "/admin/marketing/plans/p1",
    ],
    [
      "addPlanChannel",
      () =>
        adminApi.addPlanChannel("p1", { campaignSlug: "meta", label: "Meta" }),
      "POST",
      "/admin/marketing/plans/p1/channels",
    ],
    [
      "removePlanChannel",
      () => adminApi.removePlanChannel("p1", "c1"),
      "DELETE",
      "/admin/marketing/plans/p1/channels/c1",
    ],
    [
      "linkPlanCode",
      () => adminApi.linkPlanCode("p1", { referralCodeId: "c1" }),
      "POST",
      "/admin/marketing/plans/p1/codes",
    ],
    [
      "unlinkPlanCode",
      () => adminApi.unlinkPlanCode("p1", "l1"),
      "DELETE",
      "/admin/marketing/plans/p1/codes/l1",
    ],
    [
      "removePlanStoreOffer",
      () => adminApi.removePlanStoreOffer("p1", "o1"),
      "DELETE",
      "/admin/marketing/plans/p1/store-offers/o1",
    ],
    [
      "updatePlanStoreOffer",
      () => adminApi.updatePlanStoreOffer("p1", "o1", { priceMinor: 1 }),
      "PATCH",
      "/admin/marketing/plans/p1/store-offers/o1",
    ],
  ])("%s calls %s %s", async (_name, call, method, path) => {
    await call();
    const request = lastRequest();
    expect(request.method).toBe(method);
    expect(request.url).toContain(path);
  });

  it("records a store offer with POST, carrying the whole body", async () => {
    await adminApi.addPlanStoreOffer("p1", {
      platform: "ios",
      code: "FOUNDERS6",
      tierName: "premium",
      durationMonths: 6,
      priceMinor: 3000,
      maxRedemptions: 100,
      expiresOn: "2026-10-31",
      campaignSlug: "meta",
      redemptionUrl: null,
      notes: null,
    });
    const request = lastRequest();
    expect(request.method).toBe("POST");
    expect(request.url).toContain("/admin/marketing/plans/p1/store-offers");
    expect(request.body).toMatchObject({ code: "FOUNDERS6", priceMinor: 3000 });
  });

  it("upserts a metric with PUT — the verb the route is mounted on", async () => {
    // A POST here would 404, and the pages' mocks would never notice.
    await adminApi.upsertPlanMetric("p1", {
      campaignSlug: null,
      metricDate: "2026-09-12",
      spendMinor: 1000,
      impressions: null,
      clicks: null,
      landingViews: null,
      storeRedemptions: null,
      notes: null,
    });
    const request = lastRequest();
    expect(request.method).toBe("PUT");
    expect(request.url).toContain("/admin/marketing/plans/p1/metrics");
    expect(request.body).toMatchObject({
      campaignSlug: null,
      metricDate: "2026-09-12",
    });
  });
});
