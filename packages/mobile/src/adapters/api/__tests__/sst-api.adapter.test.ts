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
