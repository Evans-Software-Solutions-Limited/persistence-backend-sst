import { act, render, waitFor } from "@testing-library/react-native";
import { Text } from "react-native";

import type { OnboardingContextValue } from "../OnboardingProvider";
import { OnboardingProvider, useOnboarding } from "../OnboardingProvider";

const mockCache = new Map<string, unknown>();
const mockGetOnboarding = jest.fn();
const mockUpdateOnboarding = jest.fn();
const mockTrackAnalyticsEvent = jest.fn();
let mockUserId: string | null = "user-a";
const mockApi = {
  getOnboarding: mockGetOnboarding,
  updateOnboarding: mockUpdateOnboarding,
  trackAnalyticsEvent: mockTrackAnalyticsEvent,
};
const mockStorage = {
  getCachedOnboarding: (id: string) => mockCache.get(id) ?? null,
  cacheOnboarding: (id: string, state: unknown) => mockCache.set(id, state),
  clearCachedOnboarding: (id: string) => mockCache.delete(id),
};

jest.mock("@/ui/hooks/useAuth", () => ({
  useAuth: () => ({
    session: mockUserId ? { userId: mockUserId } : null,
  }),
}));

jest.mock("@/ui/hooks/useAdapters", () => ({
  useAdapters: () => ({
    api: mockApi,
    storage: mockStorage,
  }),
}));

let context: OnboardingContextValue;
function Probe() {
  context = useOnboarding();
  return <Text testID="page">{context.state?.currentPage ?? "none"}</Text>;
}

describe("OnboardingProvider", () => {
  beforeEach(() => {
    mockCache.clear();
    mockUserId = "user-a";
    mockGetOnboarding.mockReset().mockResolvedValue({ ok: true, value: null });
    mockUpdateOnboarding.mockReset().mockImplementation(async (input) => ({
      ok: true,
      value: {
        userId: mockUserId ?? "",
        ...input,
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    }));
    mockTrackAnalyticsEvent.mockReset().mockResolvedValue({
      ok: true,
      value: undefined,
    });
  });

  it("seeds untouched users with Premium+ athlete defaults and scopes the mirror", async () => {
    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.isLoading).toBe(false));
    expect(context.state).toMatchObject({
      userId: "user-a",
      path: "athlete",
      currentPage: "welcome",
      intentKeys: ["nutrition_mealprint", "training_loadout"],
    });
    expect(mockCache.has("user-a")).toBe(true);
    expect(mockCache.has("user-b")).toBe(false);
  });

  it("clears the boot gate from the offline mirror without awaiting the server", async () => {
    // The read that hangs offline. AuthGate refuses to route while
    // `isLoading` is true, so a cached mirror MUST resolve the gate on its
    // own — waiting on the network here is what stranded the app on an
    // infinite spinner with no connection.
    mockGetOnboarding.mockReturnValue(new Promise(() => {}));
    mockCache.set("user-a", {
      userId: "user-a",
      status: "completed",
      path: "athlete",
      currentPage: "welcome",
      intentKeys: [],
      updatedAt: "2026-09-01T12:00:00.000Z",
    });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.isLoading).toBe(false));
    expect(context.state).toMatchObject({
      userId: "user-a",
      status: "completed",
    });
    expect(context.loadError).toBeNull();
  });

  it("holds the boot gate only while there is nothing at all to route on", async () => {
    mockGetOnboarding.mockReturnValue(new Promise(() => {}));

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    // No cache and no server answer yet: there is genuinely no verdict, so
    // the gate stays up (bounded by the request timeout, not by this flag).
    expect(context.isLoading).toBe(true);
    expect(context.state).toBeNull();
  });

  it("seeds a local journey when the read never reached the server", async () => {
    // Offline / captive portal / our own timeout. The journey is completable
    // on-device, so walling the account off behind an error is the wrong
    // trade — seed it and let the user through.
    mockGetOnboarding.mockResolvedValue({
      ok: false,
      error: { kind: "api", code: "network", message: "Network error" },
    });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.isLoading).toBe(false));
    expect(context.state).toMatchObject({
      userId: "user-a",
      status: "in_progress",
      currentPage: "welcome",
    });
    // The seed is a guess about an account we could not read. Persisting it
    // would let it outrank the server's own record on a later launch.
    expect(mockCache.has("user-a")).toBe(false);
  });

  it("seeds a local journey when the request timed out", async () => {
    mockGetOnboarding.mockResolvedValue({
      ok: false,
      error: { kind: "api", code: "timeout", message: "Request timed out" },
    });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.isLoading).toBe(false));
    expect(context.state).toMatchObject({ status: "in_progress" });
  });

  it("prefers an existing offline mirror over seeding a fresh journey", async () => {
    mockGetOnboarding.mockResolvedValue({
      ok: false,
      error: { kind: "api", code: "network", message: "Network error" },
    });
    mockCache.set("user-a", {
      userId: "user-a",
      status: "in_progress",
      path: "coach",
      currentPage: "habits",
      intentKeys: [],
      updatedAt: "2026-09-01T12:00:00.000Z",
    });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.isLoading).toBe(false));
    // Real progress beats a guess: resume where they were, not at welcome.
    expect(context.state).toMatchObject({ currentPage: "habits" });
  });

  it("does not seed when the server answered with an error", async () => {
    // A reachable server that failed IS evidence the account read is broken.
    // Replaying onboarding over real progress could clobber it, so this case
    // keeps the error wall rather than seeding.
    mockGetOnboarding.mockResolvedValue({
      ok: false,
      error: { kind: "api", code: "server_error", message: "Boom" },
    });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.loadError).not.toBeNull());
    expect(context.state).toBeNull();
  });

  it("lets a finished server journey overrule a newer local replay", async () => {
    // The hazard the offline seed introduces: a locally-seeded journey always
    // carries a fresher `updatedAt` than the server's older `completed`, and
    // "newest wins" would march a done user back through setup on reconnect.
    mockCache.set("user-a", {
      userId: "user-a",
      status: "in_progress",
      path: "athlete",
      currentPage: "welcome",
      intentKeys: [],
      updatedAt: "2026-09-07T12:00:00.000Z",
    });
    mockGetOnboarding.mockResolvedValue({
      ok: true,
      value: {
        userId: "user-a",
        status: "completed",
        path: "athlete",
        currentPage: "recommendation",
        intentKeys: [],
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.state?.status).toBe("completed"));
    expect(mockUpdateOnboarding).not.toHaveBeenCalled();
  });

  it("still lets newer local progress win over an unfinished server journey", async () => {
    mockCache.set("user-a", {
      userId: "user-a",
      status: "in_progress",
      path: "athlete",
      currentPage: "train",
      intentKeys: [],
      updatedAt: "2026-09-07T12:00:00.000Z",
    });
    mockGetOnboarding.mockResolvedValue({
      ok: true,
      value: {
        userId: "user-a",
        status: "in_progress",
        path: "athlete",
        currentPage: "role",
        intentKeys: [],
        updatedAt: "2026-09-01T12:00:00.000Z",
      },
    });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.state?.currentPage).toBe("train"));
  });

  it("does not seed a fresh journey when the server read fails without a cache", async () => {
    const failure = new Error("onboarding unavailable");
    mockGetOnboarding.mockResolvedValueOnce({ ok: false, error: failure });

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.isLoading).toBe(false));
    expect(context.state).toBeNull();
    expect(context.loadError).toBe(failure);
    expect(mockCache.has("user-a")).toBe(false);
  });

  it("retries a failed initial read and clears the blocking error", async () => {
    const failure = new Error("onboarding unavailable");
    let resolveRetry!: (value: { ok: true; value: null }) => void;
    mockGetOnboarding
      .mockResolvedValueOnce({ ok: false, error: failure })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveRetry = resolve;
          }),
      );

    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );

    await waitFor(() => expect(context.loadError).toBe(failure));
    act(() => context.retryLoad());

    await waitFor(() => expect(context.isLoading).toBe(true));
    expect(context.state).toBeNull();
    expect(context.loadError).toBeNull();

    act(() => resolveRetry({ ok: true, value: null }));
    await waitFor(() => expect(context.isLoading).toBe(false));
    expect(context.loadError).toBeNull();
    expect(context.state).toMatchObject({
      userId: "user-a",
      currentPage: "welcome",
      status: "in_progress",
    });
    expect(mockGetOnboarding).toHaveBeenCalledTimes(2);
  });

  it("persists page completion locally and remotely before advancing", async () => {
    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    await waitFor(() => expect(context.isLoading).toBe(false));

    await act(async () => {
      await context.completePage("welcome");
    });

    expect(context.state?.currentPage).toBe("profile");
    expect(context.state?.completedPages).toContain("welcome");
    expect(mockUpdateOnboarding).toHaveBeenCalledWith(
      expect.objectContaining({ currentPage: "profile" }),
    );
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith({
      name: "onboarding_page_completed",
      properties: { page: "welcome" },
    });
  });

  it("serializes rapid selection and Continue writes without regressing state", async () => {
    let resolveFirst!: (value: {
      ok: true;
      value: Record<string, unknown>;
    }) => void;
    const inputs: Record<string, unknown>[] = [];
    mockUpdateOnboarding.mockImplementation((input) => {
      inputs.push(input);
      if (inputs.length === 1) {
        return new Promise((resolve) => {
          resolveFirst = resolve;
        });
      }
      return Promise.resolve({
        ok: true,
        value: {
          userId: "user-a",
          ...input,
          updatedAt: "2026-09-01T12:00:02.000Z",
        },
      });
    });
    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    await waitFor(() => expect(context.isLoading).toBe(false));

    let selection!: Promise<void>;
    let continuation!: Promise<unknown>;
    act(() => {
      selection = context.setIntentChoice(
        "nutrition",
        "nutrition_photo_estimate",
      );
      continuation = context.completePage("nutrition");
    });

    expect(context.state).toMatchObject({
      currentPage: "train",
      intentKeys: expect.arrayContaining(["nutrition_photo_estimate"]),
    });
    await waitFor(() => expect(mockUpdateOnboarding).toHaveBeenCalledTimes(1));

    resolveFirst({
      ok: true,
      value: {
        userId: "user-a",
        ...inputs[0],
        updatedAt: "2026-09-01T12:00:01.000Z",
      },
    });
    await waitFor(() => expect(mockUpdateOnboarding).toHaveBeenCalledTimes(2));
    await act(async () => {
      await Promise.all([selection, continuation]);
    });

    expect(inputs[1]).toMatchObject({
      currentPage: "train",
      intentKeys: expect.arrayContaining(["nutrition_photo_estimate"]),
    });
    expect(context.state).toMatchObject({
      currentPage: "train",
      intentKeys: expect.arrayContaining(["nutrition_photo_estimate"]),
    });
  });

  it("makes Welcome dismissal terminal", async () => {
    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    await waitFor(() => expect(context.isLoading).toBe(false));

    await act(async () => {
      await context.dismissJourney();
    });
    expect(context.state?.status).toBe("dismissed");
    expect(context.state?.dismissedAt).not.toBeNull();
  });

  it("records and tracks recommendation Skip before terminal completion", async () => {
    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    await waitFor(() => expect(context.isLoading).toBe(false));

    await act(async () => {
      await context.skipPage("recommendation");
      await context.completeJourney();
    });

    expect(context.state?.skippedPages).toContain("recommendation");
    expect(context.state?.completedPages).not.toContain("recommendation");
    expect(context.state?.status).toBe("completed");
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith({
      name: "onboarding_page_skipped",
      properties: { page: "recommendation" },
    });
  });

  it("sends camelCase, non-sensitive analytics properties", async () => {
    render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    await waitFor(() => expect(context.isLoading).toBe(false));

    await act(async () => {
      await context.setIntentChoice("nutrition", "nutrition_photo_estimate");
    });
    expect(mockTrackAnalyticsEvent).toHaveBeenCalledWith({
      name: "onboarding_intent_changed",
      properties: { intentKey: "nutrition_photo_estimate" },
    });
  });

  it("withholds the previous account state while a new account loads", async () => {
    let resolveSecond!: (value: { ok: true; value: null }) => void;
    mockGetOnboarding
      .mockResolvedValueOnce({ ok: true, value: null })
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );
    const view = render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    await waitFor(() => expect(context.state?.userId).toBe("user-a"));

    mockUserId = "user-b";
    view.rerender(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    expect(context.state).toBeNull();
    expect(context.isLoading).toBe(true);

    resolveSecond({ ok: true, value: null });
    await waitFor(() => expect(context.state?.userId).toBe("user-b"));
  });

  it("ignores a previous account's update response after identity changes", async () => {
    let resolveUpdate!: (value: {
      ok: true;
      value: Record<string, unknown>;
    }) => void;
    mockUpdateOnboarding.mockImplementationOnce(
      (input) =>
        new Promise((resolve) => {
          resolveUpdate = (value) => resolve(value);
        }),
    );
    const view = render(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    await waitFor(() => expect(context.state?.userId).toBe("user-a"));
    let completion!: Promise<unknown>;
    act(() => {
      completion = context.completePage("welcome");
    });
    await waitFor(() => expect(mockUpdateOnboarding).toHaveBeenCalledTimes(1));

    mockUserId = "user-b";
    mockGetOnboarding.mockResolvedValueOnce({ ok: true, value: null });
    view.rerender(
      <OnboardingProvider>
        <Probe />
      </OnboardingProvider>,
    );
    resolveUpdate({
      ok: true,
      value: {
        ...(mockCache.get("user-a") as Record<string, unknown>),
        userId: "user-a",
      },
    });
    await act(async () => {
      await completion;
    });
    await waitFor(() => expect(context.state?.userId).toBe("user-b"));
  });
});
