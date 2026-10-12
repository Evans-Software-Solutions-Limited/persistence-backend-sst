import { act, renderHook, waitFor } from "@testing-library/react-native";
import { forgetBootstrapSections } from "@/application/bootstrap/freshness";
import { isBootstrapPending } from "@/application/bootstrap/gate";
import { useAuth } from "@/ui/hooks/useAuth";
import { useBootstrap } from "@/ui/hooks/useBootstrap";
import {
  BOOTSTRAP_TEST_USER,
  bootstrapAdapters,
  bootstrapWrapper,
} from "./bootstrapTestHarness";

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));

afterEach(() => forgetBootstrapSections(BOOTSTRAP_TEST_USER));

describe("useBootstrap", () => {
  it("opens the gate during render, runs once per user and settles", async () => {
    const { api, storage, adapters } = bootstrapAdapters();
    // Per render: [userId known to this component, gate pending].
    const renders: [string | null, boolean][] = [];
    const { rerender } = renderHook(
      () => {
        useBootstrap();
        const { session } = useAuth();
        renders.push([
          session?.userId ?? null,
          isBootstrapPending(BOOTSTRAP_TEST_USER),
        ]);
      },
      { wrapper: bootstrapWrapper(adapters) },
    );
    // The session resolves asynchronously; only then does the run start.
    await waitFor(() => expect(api.getBootstrapCalls).toHaveLength(1));
    await waitFor(() =>
      expect(isBootstrapPending(BOOTSTRAP_TEST_USER)).toBe(false),
    );
    // The gate was already pending in the first render that knew the user,
    // so sibling hooks mounting in that commit wait instead of fetching.
    const firstWithUser = renders.find(([userId]) => userId !== null);
    expect(firstWithUser).toEqual([BOOTSTRAP_TEST_USER, true]);
    expect(api.getBootstrapCalls).toHaveLength(1);
    expect(storage.getCachedProfilePage(BOOTSTRAP_TEST_USER)).toBeTruthy();
    rerender(undefined);
    await act(async () => {});
    expect(api.getBootstrapCalls).toHaveLength(1);
  });

  it("settles without a request when offline, on failure, and does nothing signed out", async () => {
    const offline = bootstrapAdapters();
    offline.netInfo.setConnected(false);
    const offlineRenders: boolean[] = [];
    renderHook(
      () => {
        useBootstrap();
        offlineRenders.push(isBootstrapPending(BOOTSTRAP_TEST_USER));
      },
      { wrapper: bootstrapWrapper(offline.adapters) },
    );
    await waitFor(() => expect(offlineRenders).toContain(true));
    await waitFor(() =>
      expect(isBootstrapPending(BOOTSTRAP_TEST_USER)).toBe(false),
    );
    expect(offline.api.getBootstrapCalls).toHaveLength(0);

    const failing = bootstrapAdapters();
    failing.api.shouldFail = true;
    const warn = jest.spyOn(console, "warn").mockImplementation(() => {});
    renderHook(() => useBootstrap(), {
      wrapper: bootstrapWrapper(failing.adapters),
    });
    await waitFor(() => expect(failing.api.getBootstrapCalls).toHaveLength(1));
    await waitFor(() =>
      expect(isBootstrapPending(BOOTSTRAP_TEST_USER)).toBe(false),
    );
    warn.mockRestore();

    const signedOut = bootstrapAdapters(false);
    renderHook(() => useBootstrap(), {
      wrapper: bootstrapWrapper(signedOut.adapters),
    });
    await act(async () => {});
    expect(signedOut.api.getBootstrapCalls).toHaveLength(0);
  });
});
