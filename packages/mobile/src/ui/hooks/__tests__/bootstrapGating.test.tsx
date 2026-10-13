import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  forgetBootstrapSections,
  rememberBootstrapSection,
} from "@/application/bootstrap/freshness";
import { beginBootstrap, endColdStart } from "@/application/bootstrap/gate";
import { fetchUnreadCount } from "@/application/notifications/unread-count";
import { useCachedResource } from "@/ui/hooks/useCachedResource";
import { useGetStreaks } from "@/ui/hooks/useGetStreaks";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useWorkouts } from "@/ui/hooks/useWorkouts";
import {
  BOOTSTRAP_TEST_USER as USER,
  bootstrapAdapters,
  bootstrapWrapper,
} from "./bootstrapTestHarness";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

afterEach(() => {
  forgetBootstrapSections(USER);
  endColdStart();
});

describe("mount-time fetches respect the cold-start bootstrap", () => {
  it("useCachedResource serves a bootstrap-fresh cache without fetching", async () => {
    const { api, storage, adapters } = bootstrapAdapters();
    api.streaks = [{ id: "s1" }] as never;
    storage.cacheStreaks(USER, [{ id: "cached" }] as never);
    rememberBootstrapSection(USER, "streaks", Date.now());
    const spy = jest.spyOn(api, "getStreaks");
    const { result } = renderHook(() => useGetStreaks(), {
      wrapper: bootstrapWrapper(adapters),
    });
    await waitFor(() => expect(result.current.isStale).toBe(false));
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.data).toEqual([{ id: "cached" }]);
    // An explicit refresh still fetches.
    await act(async () => {
      await result.current.refresh();
    });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("useCachedResource waits for a pending bootstrap and fetches only if still stale", async () => {
    const { api, adapters } = bootstrapAdapters();
    const spy = jest.spyOn(api, "getStreaks");
    const settle = beginBootstrap(USER);
    const { result } = renderHook(
      () =>
        useCachedResource<{ n: number }>({
          read: (storage) => ({
            value: storage.getCachedStreaks(USER) as never,
            isStale: true,
          }),
          fetcher: async (a) => {
            const r = await a.getStreaks();
            return r.ok ? { ok: true, value: { n: r.value.length } } : r;
          },
          write: () => {},
        }),
      { wrapper: bootstrapWrapper(adapters) },
    );
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
    act(() => settle());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    expect(result.current.isStale).toBe(false);
  });

  it("useWorkouts does not refresh when the bootstrap wrote fresh lists", async () => {
    const { api, storage, adapters } = bootstrapAdapters();
    const spy = jest.spyOn(api, "getWorkouts");
    const settle = beginBootstrap(USER);
    const { result } = renderHook(() => useWorkouts(), {
      wrapper: bootstrapWrapper(adapters),
    });
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
    for (const type of ["mine", "assigned", "default"] as const)
      storage.cacheWorkoutsList(USER, type, [], null);
    act(() => settle());
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
    expect(result.current.mine.isStale).toBe(false);
  });

  it("useMySubscription does not query until the gate settles", async () => {
    const { api, adapters } = bootstrapAdapters();
    const spy = jest.spyOn(api, "getMySubscription");
    const settle = beginBootstrap(USER);
    renderHook(() => useMySubscription(), {
      wrapper: bootstrapWrapper(adapters),
    });
    await act(async () => {});
    expect(spy).not.toHaveBeenCalled();
    act(() => settle());
    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
  });

  it("fetchUnreadCount prefers the bootstrap's count for a mount-time call only", async () => {
    const { api, storage } = bootstrapAdapters();
    const spy = jest.spyOn(api, "getNotifications");
    rememberBootstrapSection(USER, "notifications", Date.now(), 7);
    await expect(
      fetchUnreadCount(api, storage, { preferBootstrapFor: USER }),
    ).resolves.toBe(7);
    expect(spy).not.toHaveBeenCalled();
    await fetchUnreadCount(api, storage);
    expect(spy).toHaveBeenCalledTimes(1);
    rememberBootstrapSection(USER, "notifications", Date.now());
    await fetchUnreadCount(api, storage, { preferBootstrapFor: USER });
    expect(spy).toHaveBeenCalledTimes(2);
  });
});
