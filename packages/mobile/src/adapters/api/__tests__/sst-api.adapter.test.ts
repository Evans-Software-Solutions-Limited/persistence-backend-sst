/**
 * Targeted SST adapter tests — currently focused on the dashboard
 * client-side timeout behaviour added in M1 fix-forward. The legacy SST
 * adapter is otherwise exercised via integration paths (HomeContainer,
 * ExerciseListContainer, etc.); these tests cover branches that need a
 * direct fetch() seam.
 *
 * Spec: specs/06-progress-goals/requirements.md STORY-005 AC 5.9
 */

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "http://test.local" } } },
}));

// eslint-disable-next-line import/first
import {
  DASHBOARD_REQUEST_TIMEOUT_MS,
  SSTApiAdapter,
} from "@/adapters/api/sst-api.adapter";

type FetchImpl = (input: any, init?: any) => Promise<Response>;

const globalScope = globalThis as unknown as { fetch: FetchImpl };
const originalFetch = globalScope.fetch;

afterEach(() => {
  globalScope.fetch = originalFetch;
  jest.useRealTimers();
});

function installFetchMock(impl: FetchImpl): jest.Mock {
  const mock = jest.fn(impl);
  globalScope.fetch = mock as unknown as FetchImpl;
  return mock;
}

describe("SSTApiAdapter.getDashboard timeout", () => {
  it("exposes a 10-second default timeout constant", () => {
    expect(DASHBOARD_REQUEST_TIMEOUT_MS).toBe(10_000);
  });

  it("returns an api/timeout error when the fetch is aborted", async () => {
    jest.useFakeTimers();
    installFetchMock((_url, init) => {
      // Hang until the AbortController fires; reject with a real
      // AbortError so the adapter's error mapping runs end-to-end.
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          const err = new Error("Aborted");
          err.name = "AbortError";
          reject(err);
        });
      });
    });

    const adapter = new SSTApiAdapter();
    const promise = adapter.getDashboard();
    // Fast-forward past the 10s timeout. With real timers the test
    // would have to wait the full 10s; with fake timers we do it in
    // a microsecond.
    jest.advanceTimersByTime(DASHBOARD_REQUEST_TIMEOUT_MS + 100);

    const result = await promise;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api");
    expect(result.error.code).toBe("timeout");
    expect(result.error.message).toContain(
      String(DASHBOARD_REQUEST_TIMEOUT_MS),
    );
  });

  it("returns the payload when the fetch settles inside the timeout window", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({ data: { profile: { firstName: "Alex" } } }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.getDashboard();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(
      (result.value as { profile: { firstName: string } }).profile.firstName,
    ).toBe("Alex");
  });

  it("maps non-abort errors to api/network — preserving the existing behaviour for genuine network failures", async () => {
    installFetchMock(async () => {
      throw new Error("DNS lookup failed");
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.getDashboard();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.kind).toBe("api");
    expect(result.error.code).toBe("network");
  });
});

describe("SSTApiAdapter.getWorkouts envelope (M2)", () => {
  it("unwraps the double-envelope { data, meta } including pagination + quota for type=mine", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              id: "wo-1",
              name: "Push",
              description: null,
              createdBy: "user-1",
              visibility: "private",
              estimatedDurationMinutes: 45,
              exercises: [],
              createdAt: "2026-04-28T00:00:00Z",
              updatedAt: "2026-04-28T00:00:00Z",
            },
          ],
          meta: {
            pagination: { limit: 20, offset: 0, total: 1 },
            quota: { used: 1, limit: 50 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.getWorkouts({ type: "mine" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workouts).toHaveLength(1);
    expect(result.value.workouts[0].name).toBe("Push");
    expect(result.value.total).toBe(1);
    expect(result.value.quota).toEqual({ used: 1, limit: 50 });
  });

  it("returns quota=null when the meta envelope omits it (type=default / assigned)", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          meta: { pagination: { limit: 20, offset: 0, total: 0 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.getWorkouts({ type: "default" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.workouts).toEqual([]);
    expect(result.value.quota).toBeNull();
  });

  it("propagates HTTP 401 as api/unauthorized", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({ error: "unauth" }), { status: 401 });
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.getWorkouts();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unauthorized");
  });

  it("forwards type / limit / offset as query params", async () => {
    const fetchMock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: [],
          meta: { pagination: { limit: 5, offset: 10, total: 0 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    await adapter.getWorkouts({ type: "assigned", limit: 5, offset: 10 });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("type=assigned");
    expect(url).toContain("limit=5");
    expect(url).toContain("offset=10");
  });
});

describe("SSTApiAdapter.searchExercises", () => {
  it("hits /exercises/search with the q param and unwraps the double-envelope page", async () => {
    const fetchMock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: {
            data: [
              {
                id: "ex-1",
                name: "Bench Press",
                description: null,
                instructions: null,
                category: "strength",
                difficulty_level: "intermediate",
                primary_muscles: [],
                secondary_muscles: [],
                equipment_required: [],
                accessibility_requirements: [],
                accessibility_modifications: null,
                video_url: null,
                thumbnail_url: null,
                created_by: null,
                is_public: true,
                created_at: "2026-01-01T00:00:00Z",
                updated_at: "2026-01-01T00:00:00Z",
              },
            ],
            meta: { total: 1, offset: 0, limit: 20 },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.searchExercises("bench");
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("/exercises/search");
    expect(url).toContain("q=bench");
    expect(result.value.data).toHaveLength(1);
    expect(result.value.data[0].name).toBe("Bench Press");
    expect(result.value.hasMore).toBe(false);
  });

  it("forwards limit + offset as query params when provided", async () => {
    const fetchMock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: { data: [], meta: { total: 50, offset: 20, limit: 10 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.searchExercises("press", undefined, 20, 10);
    expect(result.ok).toBe(true);
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("q=press");
    expect(url).toContain("offset=20");
    expect(url).toContain("limit=10");
    if (!result.ok) return;
    // total=50, offset=20 + 0 returned < 50 → hasMore=true
    expect(result.value.hasMore).toBe(true);
  });

  it("forwards category / equipment / muscles / difficulty / created_by filter axes", async () => {
    const fetchMock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: { data: [], meta: { total: 0, offset: 0, limit: 20 } },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    await adapter.searchExercises("press", {
      category: "cardio",
      difficulties: ["beginner"],
      muscleGroups: ["a1b2c3d4-e5f6-7890-abcd-ef1234567890"],
      equipment: ["c1b2c3d4-e5f6-7890-abcd-ef1234567890"],
      createdBy: "system",
    });
    const url = String(fetchMock.mock.calls[0][0]);
    expect(url).toContain("q=press");
    expect(url).toContain("category=cardio");
    expect(url).toContain("difficulty_level=beginner");
    expect(url).toContain(
      "targeted_muscles_any=a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    );
    expect(url).toContain("equipment_any=c1b2c3d4-e5f6-7890-abcd-ef1234567890");
    expect(url).toContain("created_by=system");
  });

  it("propagates HTTP 400 (q too short) as api error", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({ error: "q must be at least 2 characters after trim" }),
        { status: 400 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.searchExercises("a");
    expect(result.ok).toBe(false);
  });
});

describe("SSTApiAdapter.getSubscriptionTiers (M10)", () => {
  it("GETs /subscription-tiers and parses decimal-string prices to numbers", async () => {
    const mock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              tierName: "basic",
              displayName: "Basic",
              description: null,
              priceMonthly: "4.99",
              priceYearly: "49.99",
              currency: "GBP",
              features: { workouts: 10 },
              workoutLimit: 10,
              aiAccess: true,
              aiWorkoutLimit: 1,
              gymBuddyAccess: false,
              trainerClientLimit: null,
              isTrainerTier: false,
              analyticsAccess: false,
              exportAccess: false,
              stripePriceIdMonthly: "price_basic_m",
              stripePriceIdYearly: "price_basic_y",
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.getSubscriptionTiers();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0].tierName).toBe("basic");
    expect(result.value[0].priceMonthly).toBe(4.99);
    expect(result.value[0].priceYearly).toBe(49.99);
    expect(mock.mock.calls[0][0]).toBe("http://test.local/subscription-tiers");
  });

  it("passes through numeric prices when backend already emits numbers", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: [
            {
              tierName: "premium",
              displayName: "Premium",
              description: null,
              priceMonthly: 14.99,
              priceYearly: null,
              currency: "GBP",
              features: {},
              workoutLimit: null,
              aiAccess: true,
              aiWorkoutLimit: 6,
              gymBuddyAccess: true,
              trainerClientLimit: null,
              isTrainerTier: false,
              analyticsAccess: false,
              exportAccess: false,
              stripePriceIdMonthly: "price_premium_m",
              stripePriceIdYearly: null,
            },
          ],
        }),
        { status: 200 },
      );
    });
    const adapter = new SSTApiAdapter();
    const result = await adapter.getSubscriptionTiers();
    if (!result.ok) throw new Error("expected ok");
    expect(result.value[0].priceMonthly).toBe(14.99);
    expect(result.value[0].priceYearly).toBe(null);
  });

  it("returns an empty list when catalog is empty (200 + data: [])", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({ data: [] }), { status: 200 });
    });
    const adapter = new SSTApiAdapter();
    const result = await adapter.getSubscriptionTiers();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toEqual([]);
  });

  it("propagates a server failure", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({ error: "boom" }), { status: 500 });
    });
    const adapter = new SSTApiAdapter();
    const result = await adapter.getSubscriptionTiers();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server");
  });
});

describe("SSTApiAdapter.getMySubscription (M10)", () => {
  it("GETs /subscriptions/me and unwraps the envelope", async () => {
    const mock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          data: {
            subscriptionId: "us_1",
            tierName: "premium",
            paymentStatus: "active",
            billingCycle: "monthly",
            startsAt: "2026-01-01T00:00:00.000Z",
            expiresAt: "2030-01-01T00:00:00.000Z",
            cancelledAt: null,
            trialEndsAt: null,
            externalSubscriptionId: "sub_test",
            tierDisplayName: "Premium",
            tierDescription: null,
            workoutLimit: null,
            aiAccess: true,
            aiWorkoutLimit: 6,
            gymBuddyAccess: true,
            trainerClientLimit: null,
            isTrainerTier: false,
            role: "user",
            hasUsedUserTrial: false,
            hasUsedTrainerTrial: false,
            isEligibleForUserTrial: true,
            isEligibleForTrainerTrial: true,
            scheduledChange: null,
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.getMySubscription();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.tierName).toBe("premium");
    expect(result.value.isEligibleForUserTrial).toBe(true);
    expect(mock.mock.calls[0][0]).toBe("http://test.local/subscriptions/me");
  });

  it("maps 401 → api/unauthorized", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    });
    const adapter = new SSTApiAdapter();
    const result = await adapter.getMySubscription();
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("unauthorized");
  });
});

describe("SSTApiAdapter.createSubscription (M7 / M10)", () => {
  it("POSTs camelCase input as snake_case body and returns the M10 domain shape", async () => {
    const mock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          requires_action: false,
          subscription_id: "us_abc",
          stripe_subscription_id: "sub_abc",
          trial_ends_at: "2026-06-01T00:00:00.000Z",
          next_billing_date: "2026-07-01T00:00:00.000Z",
          payment_status: "trialing",
          change_type: "new",
          scheduled: false,
          effective_at: null,
          is_trial: true,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createSubscription({
      tierName: "premium",
      billingCycle: "monthly",
      paymentMethodId: "pm_card",
      useTrial: true,
      platform: "ios",
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      success: true,
      requiresAction: false,
      subscriptionId: "us_abc",
      stripeSubscriptionId: "sub_abc",
      paymentStatus: "trialing",
      changeType: "new",
      scheduled: false,
      effectiveAt: null,
      isTrial: true,
    });

    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("http://test.local/subscriptions");
    expect((init as { method: string }).method).toBe("POST");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({
      tier_name: "premium",
      billing_cycle: "monthly",
      payment_method_id: "pm_card",
      use_trial: true,
      platform: "ios",
    });
  });

  it("omits payment_method_id from the wire body when input.paymentMethodId is undefined (M10 change-of-tier)", async () => {
    const mock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          requires_action: false,
          subscription_id: "us_dg",
          stripe_subscription_id: "sub_dg",
          trial_ends_at: null,
          next_billing_date: null,
          payment_status: "active",
          change_type: "downgrade",
          scheduled: true,
          effective_at: "2026-07-01T00:00:00.000Z",
          is_trial: false,
        }),
        { status: 200 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createSubscription({
      tierName: "basic",
      billingCycle: "monthly",
      useTrial: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.changeType).toBe("downgrade");
    expect(result.value.scheduled).toBe(true);
    expect(result.value.effectiveAt).toBe("2026-07-01T00:00:00.000Z");

    const [, init] = mock.mock.calls[0];
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({
      tier_name: "basic",
      billing_cycle: "monthly",
      use_trial: false,
    });
    expect(body.payment_method_id).toBeUndefined();
    expect(body.platform).toBeUndefined();
  });

  it("propagates the requiresAction shape including clientSecret + reinstated", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          requires_action: true,
          subscription_id: "us_3ds",
          stripe_subscription_id: "sub_3ds",
          trial_ends_at: null,
          next_billing_date: null,
          payment_status: "incomplete",
          client_secret: "pi_3ds_secret",
          reinstated: true,
          change_type: "reinstate",
          scheduled: false,
          effective_at: null,
          is_trial: false,
        }),
        { status: 200 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createSubscription({
      tierName: "premium",
      billingCycle: "monthly",
      paymentMethodId: "pm_card",
      useTrial: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.requiresAction).toBe(true);
    expect(result.value.clientSecret).toBe("pi_3ds_secret");
    expect(result.value.reinstated).toBe(true);
    expect(result.value.changeType).toBe("reinstate");
  });

  it("maps a backend 400 + { error } into api/server with the message preserved", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          error:
            "Cannot create subscription for free tier. Free tier is the default state.",
        }),
        { status: 400 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createSubscription({
      tierName: "free",
      billingCycle: "monthly",
      paymentMethodId: "pm_card",
      useTrial: false,
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain("free tier");
    expect(result.error.status).toBe(400);
  });
});

describe("SSTApiAdapter.cancelSubscription (M7 / M10)", () => {
  it("POSTs to /subscriptions/:id/cancel with the body, returns the domain shape", async () => {
    const mock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          cancelled_at: "2026-05-21T12:00:00.000Z",
          subscription_ends_at: "2026-06-01T00:00:00.000Z",
          message:
            "Subscription will be cancelled at the end of the billing period",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.cancelSubscription("us_abc", {
      cancelImmediately: false,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toMatchObject({
      success: true,
      cancelledAt: "2026-05-21T12:00:00.000Z",
      subscriptionEndsAt: "2026-06-01T00:00:00.000Z",
    });

    const [url, init] = mock.mock.calls[0];
    expect(url).toBe("http://test.local/subscriptions/us_abc/cancel");
    expect((init as { method: string }).method).toBe("POST");
    const body = JSON.parse((init as { body: string }).body);
    expect(body).toEqual({ cancel_immediately: false });
  });

  it("defaults the body to {} when no input is provided", async () => {
    const mock = installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          success: true,
          cancelled_at: "2026-05-21T12:00:00.000Z",
          subscription_ends_at: "2026-06-01T00:00:00.000Z",
          message:
            "Subscription will be cancelled at the end of the billing period",
        }),
        { status: 200 },
      );
    });

    const adapter = new SSTApiAdapter();
    await adapter.cancelSubscription("us_abc");
    const [, init] = mock.mock.calls[0];
    expect(JSON.parse((init as { body: string }).body)).toEqual({});
  });

  it("maps a backend 404 + { error } into api/not_found", async () => {
    installFetchMock(async () => {
      return new Response(JSON.stringify({ error: "Subscription not found" }), {
        status: 404,
      });
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.cancelSubscription("us_missing");
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("not_found");
  });
});

describe("SSTApiAdapter 402 entitlement-denied interception (M10.5)", () => {
  it("parses a structured 402 body into an ApiError with the entitlement payload populated", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "Subscription does not include this feature",
          feature: "create_workout",
          current_tier: "basic",
          upgrade_to: "premium",
          upgrade_price_monthly: 14.99,
        }),
        { status: 402, headers: { "Content-Type": "application/json" } },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "Push Day",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("entitlement_denied");
    expect(result.error.status).toBe(402);
    expect(result.error.message).toBe(
      "Subscription does not include this feature",
    );
    expect(result.error.entitlement).toEqual({
      feature: "create_workout",
      currentTier: "basic",
      upgradeTo: "premium",
      upgradePriceMonthly: 14.99,
    });
  });

  it("converts snake_case wire fields to camelCase on the domain payload", async () => {
    // Anti-regression: the contract is camelCase domain-side. Any drift
    // would leave snake_case keys leaking into containers/presenters.
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "denied",
          feature: "ai_workout",
          current_tier: "free",
          upgrade_to: "basic",
          upgrade_price_monthly: 4.99,
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.recordSession({
      workoutId: null,
      startedAt: "2026-05-24T00:00:00.000Z",
      status: "completed",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.entitlement).toBeDefined();
    // The shape MUST be camelCase. The presence of a snake_case key
    // would be a contract bug.
    const e = result.error.entitlement!;
    expect(Object.keys(e)).toEqual(
      expect.arrayContaining([
        "feature",
        "currentTier",
        "upgradeTo",
        "upgradePriceMonthly",
      ]),
    );
    expect((e as Record<string, unknown>).current_tier).toBeUndefined();
    expect((e as Record<string, unknown>).upgrade_to).toBeUndefined();
    expect(
      (e as Record<string, unknown>).upgrade_price_monthly,
    ).toBeUndefined();
  });

  it("preserves null upgrade_to + null upgrade_price_monthly (top-tier denial path)", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "Already at top tier",
          feature: "trainer_clients",
          current_tier: "individual_trainer_pro",
          upgrade_to: null,
          upgrade_price_monthly: null,
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "x",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("entitlement_denied");
    expect(result.error.entitlement).toEqual({
      feature: "trainer_clients",
      currentTier: "individual_trainer_pro",
      upgradeTo: null,
      upgradePriceMonthly: null,
    });
  });

  it("falls back to api/server when the 402 body is malformed (no code field)", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          error: "Payment required but no entitlement context",
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "x",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    // Status preserved so containers can still render a generic 402
    // message, but no entitlement claim is made (don't pretend it's a
    // gate we can route around).
    expect(result.error.code).toBe("server");
    expect(result.error.status).toBe(402);
    expect(result.error.entitlement).toBeUndefined();
  });

  it("falls back to api/server when the 402 body has code but is missing required fields", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "denied",
          // Missing feature / current_tier — the wire contract requires
          // both. Adapter must NOT silently default them.
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "x",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server");
    expect(result.error.entitlement).toBeUndefined();
  });

  it("falls back to api/server when the 402 body has wrong field types (defensive against contract drift)", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "denied",
          feature: "create_workout",
          current_tier: 42, // wrong type — should be string
          upgrade_to: "premium",
          upgrade_price_monthly: 14.99,
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "x",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server");
    expect(result.error.entitlement).toBeUndefined();
  });

  it("falls back to api/server when upgrade_to or upgrade_price_monthly is the wrong type", async () => {
    // upgrade_to must be string|null (NOT undefined / number).
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "denied",
          feature: "ai_workout",
          current_tier: "free",
          upgrade_to: 42, // wrong type
          upgrade_price_monthly: 4.99,
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "x",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server");
    expect(result.error.entitlement).toBeUndefined();
  });

  it("falls back to api/server when upgrade_price_monthly is the wrong type", async () => {
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "denied",
          feature: "ai_workout",
          current_tier: "free",
          upgrade_to: "basic",
          upgrade_price_monthly: "4.99", // wrong type — string, not number
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "x",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server");
    expect(result.error.entitlement).toBeUndefined();
  });

  it("falls back to api/server when the 402 body is not JSON (text/html, empty, etc.)", async () => {
    installFetchMock(async () => {
      return new Response("<html>402 Payment Required</html>", { status: 402 });
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.createWorkout({
      name: "x",
      visibility: "private",
      exercises: [],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("server");
    expect(result.error.entitlement).toBeUndefined();
  });

  it("does not stamp entitlement payload on 401 / 403 / 404 / 500 responses (only 402)", async () => {
    const statuses = [401, 403, 404, 500];
    for (const status of statuses) {
      installFetchMock(async () => {
        return new Response(
          JSON.stringify({
            // Even if a malicious / broken backend echoed the
            // ENTITLEMENT_DENIED shape on a non-402 status, the
            // adapter must NOT promote it — code stays per-status
            // and the entitlement field stays unset.
            code: "ENTITLEMENT_DENIED",
            error: "test",
            feature: "create_workout",
            current_tier: "basic",
            upgrade_to: "premium",
            upgrade_price_monthly: 14.99,
          }),
          { status },
        );
      });

      const adapter = new SSTApiAdapter();
      const result = await adapter.createWorkout({
        name: "x",
        visibility: "private",
        exercises: [],
      });
      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).not.toBe("entitlement_denied");
      expect(result.error.entitlement).toBeUndefined();
      expect(result.error.status).toBe(status);
    }
  });

  it("intercepts 402 on the multipart avatar-upload path too (uniform handling)", async () => {
    // uploadAvatar has its own fetch loop because of FormData — verify
    // the same mapping applies there. The backend doesn't gate avatar
    // uploads today, but the adapter shouldn't silently drop a 402 if
    // a future endpoint gets gated.
    installFetchMock(async () => {
      return new Response(
        JSON.stringify({
          code: "ENTITLEMENT_DENIED",
          error: "denied",
          feature: "create_workout",
          current_tier: "free",
          upgrade_to: "basic",
          upgrade_price_monthly: 4.99,
        }),
        { status: 402 },
      );
    });

    const adapter = new SSTApiAdapter();
    const result = await adapter.uploadAvatar({
      uri: "file:///tmp/avatar.jpg",
      mimeType: "image/jpeg",
      name: "avatar.jpg",
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("entitlement_denied");
    expect(result.error.entitlement?.feature).toBe("create_workout");
  });
});
