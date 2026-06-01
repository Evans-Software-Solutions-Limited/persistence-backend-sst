import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { Alert, Pressable, Switch, Text, TextInput, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { MockPaymentsAdapter } from "@/adapters/payments/__tests__/mock.adapter";
import { InMemoryNetInfoAdapter } from "@/adapters/netInfo/__tests__/InMemoryNetInfoAdapter";
import type { ProfilePageData } from "@/domain/models/profilePage";
import type { Adapters } from "@/shared/types";
import { EditProfilePresenter } from "@/ui/presenters/EditProfilePresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import config from "../../../../tamagui.config";
import { EditProfileContainer } from "../EditProfileContainer";

jest.setTimeout(15_000);

jest.mock("@/ui/presenters/EditProfilePresenter");
const MockPresenter = jest.mocked(EditProfilePresenter);

MockPresenter.mockImplementation((props) => {
  return (
    <View testID="edit-profile-presenter-stub">
      <Text testID="stub-loading">
        {props.isLoadingInitial ? "true" : "false"}
      </Text>
      <Text testID="stub-saving">{props.isSaving ? "true" : "false"}</Text>
      <Text testID="stub-error">{props.errorMessage ?? "none"}</Text>
      <TextInput
        testID="stub-full-name"
        value={props.fullName}
        onChangeText={(t) => props.onFullNameChange(t)}
      />
      <Text testID="stub-fitness-level">{props.fitnessLevel}</Text>
      <Pressable
        testID="stub-set-fitness-advanced"
        onPress={() => props.onFitnessLevelChange("advanced")}
      />
      <TextInput
        testID="stub-dob"
        value={props.dateOfBirth}
        onChangeText={(t) => props.onDateOfBirthChange(t)}
      />
      <Switch
        testID="stub-public-switch"
        value={props.isProfilePublic}
        onValueChange={(v) => props.onIsProfilePublicChange(v)}
      />
      <Pressable testID="stub-save" onPress={() => props.onSave()} />
      <Pressable testID="stub-back" onPress={() => props.onBack()} />
    </View>
  );
});

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack }),
}));

// The container fires an inline `processSyncQueue` drain after a successful
// save (offline-first: optimistic cache + queue, drain for immediacy). That
// drain calls global fetch — stub it so the drain resolves cleanly and the
// queue entry marks completed.
const mockFetch = jest.fn();
(globalThis as Record<string, unknown>).fetch = mockFetch;

function makeProfilePagePayload(
  overrides: Partial<ProfilePageData["profile"]> = {},
): ProfilePageData {
  return {
    profile: {
      id: "user-1",
      fullName: "Brad Simms",
      email: "brad@example.com",
      username: null,
      avatarUrl: null,
      role: "user",
      fitnessLevel: "intermediate",
      dateOfBirth: null,
      heightCm: null,
      weightKg: null,
      preferredUnits: "metric",
      isProfilePublic: false,
      createdAt: "2026-01-01T00:00:00.000Z",
      ...overrides,
    },
    subscription: {
      tierName: null,
      tierDisplayName: null,
      status: null,
      isFreeTier: true,
      isTrainerTier: false,
      expiresAt: null,
      cancelledAt: null,
      workoutLimit: null,
      isUnlimited: false,
    },
    stats: { workoutsCompleted: 0 },
    recentAchievements: [],
    activeTrainers: [],
    pendingTrainerRequests: [],
  };
}

async function createTestAdapters(): Promise<{
  adapters: Adapters;
  auth: InMemoryAuthAdapter;
  storage: InMemoryStorageAdapter;
  api: InMemoryApiAdapter;
}> {
  const auth = new InMemoryAuthAdapter();
  await auth.signInWithEmail("lifter@example.com", "password");
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new MockPaymentsAdapter(),
    netInfo: new InMemoryNetInfoAdapter(),
  };
  return { adapters, auth, storage, api };
}

function TestWrapper({
  children,
  adapters,
}: {
  children: ReactNode;
  adapters: Adapters;
}) {
  return (
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 44, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TamaguiProvider config={config} defaultTheme="dark">
        <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
      </TamaguiProvider>
    </SafeAreaProvider>
  );
}

describe("EditProfileContainer", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBack.mockReset();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("hydrates from the cached profile-page payload", async () => {
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });
    expect(getByTestId("stub-full-name").props.value).toBe("Brad Simms");
    expect(getByTestId("stub-fitness-level").props.children).toBe(
      "intermediate",
    );
  });

  it("optimistically caches + enqueues a PATCH /profile mutation, then routes back", async () => {
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.changeText(getByTestId("stub-full-name"), "Brad S Edited");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-set-fitness-advanced"));
    });
    await act(async () => {
      fireEvent(getByTestId("stub-public-switch"), "valueChange", true);
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });

    // Offline-first: a PATCH /profile mutation is queued with the diffed
    // fields, then drained inline. Assert on the drained request body (the
    // queue entry completes + is pruned after a successful drain).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/profile");
    expect(init.method).toBe("PATCH");
    expect(JSON.parse(init.body)).toEqual({
      fullName: "Brad S Edited",
      fitnessLevel: "advanced",
      isProfilePublic: true,
    });

    // Optimistic cache write — the cached profile-page payload reflects the
    // edit immediately so the drawer + form survive an offline save.
    const cached = storage.getCachedProfilePage(userId);
    expect(cached?.payload.profile.fullName).toBe("Brad S Edited");
    expect(cached?.payload.profile.fitnessLevel).toBe("advanced");
    expect(cached?.payload.profile.isProfilePublic).toBe(true);
  });

  it("queues fullName: null when the user clears a previously-set name", async () => {
    // PR #68 high-severity find: the user must be able to clear their name.
    // The diff-on-save still emits fullName: null; the offline path carries
    // it through the queue (the server schema accepts null — covered by a
    // backend test).
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.changeText(getByTestId("stub-full-name"), "   ");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });

    // Diff-on-save: only the fullName changed (initial "Brad Simms" → null).
    // fitnessLevel and isProfilePublic stayed put and MUST NOT be in the
    // payload (PR #68 medium-severity find: silent fitnessLevel overwrite).
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      fullName: null,
    });
  });

  it("does NOT emit fitnessLevel when the user had no stored level and only edited the public switch", async () => {
    // The picker collapses null → "beginner" for display. Diffing against
    // the same collapsed snapshot means an untouched picker emits nothing.
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(
      userId,
      makeProfilePagePayload({ fitnessLevel: null }),
    );

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent(getByTestId("stub-public-switch"), "valueChange", true);
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload).toEqual({ isProfilePublic: true });
    expect(payload).not.toHaveProperty("fitnessLevel");
    expect(payload).not.toHaveProperty("fullName");
  });

  it("rejects an invalid DOB before enqueueing — surfaces an error, no queue entry, no navigation", async () => {
    // PR #94 medium-severity find: an unparseable date would 500 the server
    // on every offline drain. The command validates BEFORE enqueueing, so a
    // bad date never reaches the queue.
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.changeText(getByTestId("stub-dob"), "1990-13-50");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-error").props.children).not.toBe("none");
    });
    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(mockBack).not.toHaveBeenCalled();
  });

  it("queues dateOfBirth: null when the user clears their DOB", async () => {
    // PR #94 high-severity find: clearing DOB must work. Empty field → null
    // in the payload; the server schema accepts null (backend test covers it).
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(
      userId,
      makeProfilePagePayload({ dateOfBirth: "1990-01-15" }),
    );

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.changeText(getByTestId("stub-dob"), "");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      dateOfBirth: null,
    });
  });

  it("routes back without enqueueing when nothing changed and the user taps Save", async () => {
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    expect(storage.getPendingMutations()).toHaveLength(0);
    expect(mockBack).toHaveBeenCalled();
  });

  it("still routes back + queues when offline (the inline drain failing is non-fatal)", async () => {
    // Offline-first invariant: Save must not block on the network. The
    // inline drain rejects (offline), but the optimistic cache write + queue
    // entry already landed and the user is routed back regardless.
    mockFetch.mockRejectedValue(new Error("offline"));
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.changeText(getByTestId("stub-full-name"), "Edited Offline");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    await waitFor(() => {
      expect(mockBack).toHaveBeenCalled();
    });
    // The optimistic cache write survived even though the drain failed.
    expect(storage.getCachedProfilePage(userId)?.payload.profile.fullName).toBe(
      "Edited Offline",
    );
    // The mutation is still queued for the next drain (useSyncWorker on
    // foreground). A failed inline drain marks it failed-but-retriable, so
    // it remains in the pending pool.
    expect(storage.getPendingMutations()).toHaveLength(1);
  });

  it("routes back without prompting when the form is unchanged", async () => {
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-back"));
    });

    expect(alertSpy).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it("prompts a discard-confirm Alert when the form is dirty, then routes on confirm", async () => {
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.changeText(getByTestId("stub-full-name"), "Dirty Name");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-back"));
    });

    expect(alertSpy).toHaveBeenCalled();
    const lastCall = alertSpy.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("Discard changes?");
    const buttons = lastCall?.[2] as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    expect(buttons.map((b) => b.text)).toEqual(["Keep editing", "Discard"]);
    expect(mockBack).not.toHaveBeenCalled();

    // Confirm discard.
    const discard = buttons.find((b) => b.style === "destructive");
    await act(async () => {
      discard?.onPress?.();
    });
    expect(mockBack).toHaveBeenCalled();
  });
});
