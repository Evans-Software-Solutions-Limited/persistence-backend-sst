import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { Alert, Pressable, Switch, Text, View } from "react-native";
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
import { PrivacySettingsPresenter } from "@/ui/presenters/PrivacySettingsPresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import config from "../../../../tamagui.config";
import { PrivacySettingsContainer } from "../PrivacySettingsContainer";

jest.setTimeout(15_000);

jest.mock("@/ui/presenters/PrivacySettingsPresenter");
const MockPresenter = jest.mocked(PrivacySettingsPresenter);

MockPresenter.mockImplementation((props) => (
  <View testID="privacy-settings-presenter-stub">
    <Text testID="stub-loading">{props.isLoading ? "true" : "false"}</Text>
    <Switch
      testID="stub-is-public"
      value={props.isProfilePublic}
      onValueChange={() => {}}
    />
    <Pressable
      testID="stub-update-public"
      onPress={() => props.onUpdateVisibility("public")}
    />
    <Pressable
      testID="stub-update-private"
      onPress={() => props.onUpdateVisibility("private")}
    />
    <Pressable testID="stub-back" onPress={() => props.onBack()} />
  </View>
));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
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
  await auth.signInWithEmail("brad@example.com", "password");
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

describe("PrivacySettingsContainer", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockBack.mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("hydrates the toggle from the cached profile-page payload", async () => {
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(
      userId,
      makeProfilePagePayload({ isProfilePublic: true }),
    );

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <PrivacySettingsContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });
    expect(getByTestId("stub-is-public").props.value).toBe(true);
  });

  it("PATCHes isProfilePublic=true and invalidates the cache when Public is picked", async () => {
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
        <PrivacySettingsContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-update-public"));
    });

    await waitFor(() => {
      expect(updateSpy).toHaveBeenCalledWith({ isProfilePublic: true });
    });
    expect(invalidateSpy).toHaveBeenCalledWith(userId);
    expect(getByTestId("stub-is-public").props.value).toBe(true);
  });

  it("skips the API call when the tapped option matches the current value", async () => {
    const { adapters, storage, auth, api } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());
    const updateSpy = jest.spyOn(api, "updateProfile");

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <PrivacySettingsContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      // Cached state is private; tap Private again — should no-op.
      fireEvent.press(getByTestId("stub-update-private"));
    });
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("reverts the toggle and alerts when the update fails", async () => {
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
    // Force the next mayFail() to return an error.
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "network",
      message: "boom",
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <PrivacySettingsContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-update-public"));
    });

    await waitFor(() => {
      expect(alertSpy).toHaveBeenCalledWith(
        "Error",
        "Failed to update privacy settings",
      );
    });
    expect(getByTestId("stub-is-public").props.value).toBe(false);
  });

  it("routes back when onBack fires", async () => {
    const { adapters, storage, auth } = await createTestAdapters();
    const userId = (auth as InMemoryAuthAdapter).currentSession?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <PrivacySettingsContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("stub-loading").props.children).toBe("false");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-back"));
    });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
