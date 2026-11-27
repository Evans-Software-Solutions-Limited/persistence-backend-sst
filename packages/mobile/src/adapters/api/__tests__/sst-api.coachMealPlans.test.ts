/** PER-135: the coach meal-plan routes on the SST adapter. */

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: { apiUrl: "http://test.local" } } },
}));

// eslint-disable-next-line import/first
import { SSTApiAdapter } from "@/adapters/api/sst-api.adapter";

type FetchImpl = (input: any, init?: any) => Promise<Response>;
const globalScope = globalThis as unknown as { fetch: FetchImpl };
const originalFetch = globalScope.fetch;

afterEach(() => {
  globalScope.fetch = originalFetch;
});

function reply(body: unknown, status = 200): jest.Mock {
  const mock = jest.fn(
    async () =>
      new Response(status === 204 ? null : JSON.stringify(body), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
  );
  globalScope.fetch = mock as unknown as FetchImpl;
  return mock;
}

const call = (mock: jest.Mock) => {
  const [url, init] = mock.mock.calls.at(-1) as [string, any];
  return {
    url,
    method: init.method,
    body: init.body ? JSON.parse(init.body) : undefined,
    key: init.headers["Idempotency-Key"],
  };
};

describe("SSTApiAdapter coach meal plans (PER-135)", () => {
  const api = new SSTApiAdapter();

  it("reads a client's plans and calorie adherence", async () => {
    let m = reply({ data: { assignments: [], target: null, asOf: "t" } });
    const plans = await api.getCoachClientMealPlans("c/1");
    expect(plans.ok && plans.value.asOf).toBe("t");
    expect(call(m).url).toContain("/trainers/me/clients/c%2F1/meal-plans");

    m = reply({
      data: {
        calories: {
          daysOnTarget: 5,
          daysCounted: 7,
          daysNotLogged: 1,
          from: "x",
        },
      },
    });
    const adh = await api.getCoachClientCalorieAdherence("c1");
    expect(adh.ok && adh.value).toEqual({
      daysOnTarget: 5,
      daysCounted: 7,
      daysNotLogged: 1,
    });
    expect(call(m).url).toContain(
      "/trainers/me/clients/c1/adherence?window=7d",
    );
    reply({ data: { asOf: "t" } });
    const none = await api.getCoachClientCalorieAdherence("c1");
    expect(none.ok && none.value).toBeNull();
    reply({ error: "nope" }, 500);
    expect((await api.getCoachClientCalorieAdherence("c1")).ok).toBe(false);
  });

  it("sends, changes the note, removes and shares", async () => {
    let m = reply({ data: {} }, 201);
    expect((await api.assignCoachMealPlan("c1", "p1", "Hi", "k1")).ok).toBe(
      true,
    );
    expect(call(m)).toMatchObject({
      method: "POST",
      body: { planId: "p1", note: "Hi" },
      key: "k1",
    });
    m = reply({ data: {} });
    expect((await api.updateCoachPlanNote("c1", "a1", null)).ok).toBe(true);
    expect(call(m)).toMatchObject({
      method: "PATCH",
      body: { note: null },
    });
    expect(call(m).url).toContain("/meal-plans/a1");
    m = reply(null, 204);
    expect((await api.removeCoachPlanAssignment("c1", "a1")).ok).toBe(true);
    expect(call(m).method).toBe("DELETE");
    m = reply({ data: { recipeId: "copy", created: true } }, 201);
    const shared = await api.shareCoachRecipe("c1", "r1");
    expect(shared.ok && shared.value).toEqual({
      recipeId: "copy",
      created: true,
    });
    expect(call(m).url).toContain("/recipes/r1/share");
  });

  it("passes failures through", async () => {
    reply({ error: "not_found" }, 404);
    const a = await api.assignCoachMealPlan("c1", "p1", null, "k");
    expect(!a.ok && a.error.status).toBe(404);
    reply({ error: "x" }, 500);
    expect((await api.updateCoachPlanNote("c1", "a1", "n")).ok).toBe(false);
    reply({ error: "x" }, 500);
    expect((await api.removeCoachPlanAssignment("c1", "a1")).ok).toBe(false);
    reply({ error: "x" }, 404);
    expect((await api.shareCoachRecipe("c1", "r1")).ok).toBe(false);
  });
});
