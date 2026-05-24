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

  it("PATCHes the profile, invalidates the cache, and routes back on save", async () => {
    const { adapters, storage, auth, api } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());
    api.profiles = [
      {
        id: userId,
        email: "brad@example.com",
        fullName: "Brad Simms",
        role: "user",
        fitnessLevel: "intermediate",
        avatarUrl: null,
        isProfilePublic: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const invalidateSpy = jest.spyOn(storage, "invalidateProfilePage");
    const updateSpy = jest.spyOn(api, "updateProfile");

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
    expect(updateSpy).toHaveBeenCalledWith({
      fullName: "Brad S Edited",
      fitnessLevel: "advanced",
      isProfilePublic: true,
    });
    expect(invalidateSpy).toHaveBeenCalledWith(userId);
  });

  it("sends fullName as null when the user clears a previously-set name", async () => {
    // Inspector Brad PR #68 high-severity find: the old `Optional(String)`
    // schema rejected null end-to-end, so even though the in-memory adapter
    // accepted this body, the real backend would have 422'd. Schema is now
    // widened to `Optional(Union([String, Null]))` (covered by a backend
    // test) and the diff-on-save still emits fullName: null when the user
    // genuinely wipes a stored name.
    const { adapters, storage, auth, api } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());
    api.profiles = [
      {
        id: userId,
        email: "brad@example.com",
        fullName: "Brad Simms",
        role: "user",
        fitnessLevel: "intermediate",
        avatarUrl: null,
        isProfilePublic: false,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    ];
    const updateSpy = jest.spyOn(api, "updateProfile");

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
      expect(updateSpy).toHaveBeenCalled();
    });
    // Diff-on-save: only the fullName changed (initial "Brad Simms" → null).
    // fitnessLevel and isProfilePublic stayed put and MUST NOT be in the body
    // (Inspector Brad PR #68 medium-severity find: silent fitnessLevel
    // overwrite when only an unrelated field was edited).
    const call = updateSpy.mock.calls[0][0];
    expect(call).toEqual({ fullName: null });
  });

  it("does NOT emit fitnessLevel when the user had no stored level and only edited the public switch", async () => {
    // The picker collapses null → "beginner" for display. Before the diff-
    // on-save fix, every save sent `fitnessLevel: "beginner"`, silently
    // writing a real value to a user who'd never picked one. Now we diff
    // against the same collapsed snapshot, so an untouched picker emits
    // nothing.
    const { adapters, storage, auth, api } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(
      userId,
      makeProfilePagePayload({ fitnessLevel: null }),
    );
    const updateSpy = jest.spyOn(api, "updateProfile");

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
      expect(updateSpy).toHaveBeenCalled();
    });
    const call = updateSpy.mock.calls[0][0];
    expect(call).toEqual({ isProfilePublic: true });
    expect(call).not.toHaveProperty("fitnessLevel");
    expect(call).not.toHaveProperty("fullName");
  });

  it("routes back without calling updateProfile when nothing changed and the user taps Save", async () => {
    const { adapters, storage, auth, api } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());
    const updateSpy = jest.spyOn(api, "updateProfile");

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

    expect(updateSpy).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalled();
  });

  it("surfaces an error message and does not navigate when save fails", async () => {
    const { adapters, storage, auth, api } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());
    api.shouldFail = true;
    api.failError = { kind: "api", code: "server", message: "boom" };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <EditProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    // Split: the diff-on-save logic reads `fullName` from the handleSave
    // closure, which is recreated by useCallback when state changes. Firing
    // changeText + press in the same act() leaves handleSave still pointing
    // at the pre-edit closure (empty diff → no API call → silent back-route)
    // and the test would assert against a no-op rather than a failed save.
    await act(async () => {
      fireEvent.changeText(getByTestId("stub-full-name"), "Edited");
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-save"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-error").props.children).not.toBe("none");
    });
    expect(mockBack).not.toHaveBeenCalled();
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
