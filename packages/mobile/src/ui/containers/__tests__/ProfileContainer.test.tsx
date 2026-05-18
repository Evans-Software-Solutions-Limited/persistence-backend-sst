import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { Alert, Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { ProfilePageData } from "@/domain/models/profilePage";
import type { Adapters } from "@/shared/types";
import { ProfilePresenter } from "@/ui/presenters/ProfilePresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import config from "../../../../tamagui.config";
import { ProfileContainer } from "../ProfileContainer";

jest.setTimeout(15_000);

// Native modules pulled in by useAvatarUpload — Jest can't load the real
// expo-modules-core glue, so stub the surface that the hook touches.
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));

jest.mock("@/ui/presenters/ProfilePresenter");
const MockPresenter = jest.mocked(ProfilePresenter);

MockPresenter.mockImplementation((props) => {
  return (
    <View testID="profile-presenter-stub">
      <Text testID="stub-email">{props.email ?? "none"}</Text>
      <Text testID="stub-display-name">{props.displayName ?? "none"}</Text>
      <Text testID="stub-role">{props.userRoleLabel}</Text>
      <Text testID="stub-workouts">{props.workoutsCompleted}</Text>
      <Text testID="stub-is-trainer">{props.isTrainer ? "true" : "false"}</Text>
      <Text testID="stub-active-trainers-count">
        {props.activeTrainers.length}
      </Text>
      <Text testID="stub-initial-loading">
        {props.isInitialLoading ? "true" : "false"}
      </Text>
      <Text testID="stub-refreshing">
        {props.isRefreshing ? "true" : "false"}
      </Text>
      <Text testID="stub-signing-out">
        {props.isSigningOut ? "true" : "false"}
      </Text>
      <Text testID="stub-error">{props.errorMessage ?? "none"}</Text>
      <Pressable
        testID="stub-sign-out"
        onPress={() => {
          props.onSignOut();
        }}
      />
      <Pressable
        testID="stub-avatar"
        onPress={() => {
          props.onSelectProfilePicture();
        }}
      />
      <Pressable
        testID="stub-refresh"
        onPress={() => {
          props.onRefresh();
        }}
      />
      <Pressable
        testID="stub-edit-profile"
        onPress={() => {
          props.onEditProfile();
        }}
      />
      <Pressable
        testID="stub-manage-sub"
        onPress={() => {
          props.onManageSubscription();
        }}
      />
      <Pressable
        testID="stub-upgrade"
        onPress={() => {
          props.onUpgradeSubscription();
        }}
      />
      <Pressable
        testID="stub-become-trainer"
        onPress={() => {
          props.onBecomeTrainer();
        }}
      />
      <Pressable
        testID="stub-health-data"
        onPress={() => {
          props.onHealthData();
        }}
      />
      <Pressable
        testID="stub-notifications"
        onPress={() => {
          props.onNotifications();
        }}
      />
      <Pressable
        testID="stub-notification-prefs"
        onPress={() => {
          props.onNotificationPreferences();
        }}
      />
      <Pressable
        testID="stub-help-center"
        onPress={() => {
          props.onHelpCenter();
        }}
      />
      <Pressable
        testID="stub-contact-support"
        onPress={() => {
          props.onContactSupport();
        }}
      />
      <Pressable
        testID="stub-terms"
        onPress={() => {
          props.onTermsOfService();
        }}
      />
      <Pressable
        testID="stub-privacy"
        onPress={() => {
          props.onPrivacyPolicy();
        }}
      />
    </View>
  );
});

// expo-router push spy — `useFocusEffect` is hard-mocked below so the
// container's focus refetch behaves like a one-shot useEffect.
const mockPush = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush }),
  useFocusEffect: (cb: () => void | (() => void)) => {
    // Mirror the legacy shape: run the callback once on mount.
    const React = jest.requireActual("react") as typeof import("react");
    React.useEffect(() => {
      const cleanup = cb();
      return typeof cleanup === "function" ? cleanup : undefined;
    }, [cb]);
  },
}));

function makeProfilePagePayload(
  overrides: Partial<ProfilePageData> = {},
): ProfilePageData {
  return {
    profile: {
      id: "user-1",
      fullName: "Brad Simms",
      email: "brad@example.com",
      username: null,
      avatarUrl: null,
      role: "user",
      fitnessLevel: null,
      heightCm: null,
      weightKg: null,
      preferredUnits: "metric",
      isProfilePublic: false,
      createdAt: "2026-01-01T00:00:00.000Z",
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
    stats: { workoutsCompleted: 7 },
    recentAchievements: [],
    activeTrainers: [],
    pendingTrainerRequests: [],
    ...overrides,
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
    payments: new StubPaymentsAdapter(),
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

describe("ProfileContainer", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockPush.mockReset();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("renders cache-empty + refreshing when no cache exists and api succeeds", async () => {
    const { adapters, api } = await createTestAdapters();
    api.profilePage = makeProfilePagePayload();

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    expect(getByTestId("stub-display-name").props.children).toBe("Brad Simms");
    expect(getByTestId("stub-workouts").props.children).toBe(7);
  });

  it("renders cached data immediately on mount", async () => {
    const { adapters, storage } = await createTestAdapters();
    // Pre-seed the cache for the authenticated user. The fixture uses
    // the auth adapter's default user id — InMemoryAuthAdapter's
    // signInWithEmail seeds a deterministic id we can read.
    const userId = (adapters.auth as InMemoryAuthAdapter).currentSession
      ?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });
    // Cache is fresh (just written) so no background refresh is fired.
    expect(getByTestId("stub-initial-loading").props.children).toBe("false");
  });

  it("derives the trainer-tier flag from the subscription slice", async () => {
    const { adapters, api } = await createTestAdapters();
    api.profilePage = makeProfilePagePayload({
      subscription: {
        tierName: "trainer_standard",
        tierDisplayName: "Trainer Standard",
        status: "active",
        isFreeTier: false,
        isTrainerTier: true,
        expiresAt: null,
        cancelledAt: null,
        workoutLimit: null,
        isUnlimited: true,
      },
    });

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-is-trainer").props.children).toBe("true");
    });
  });

  it("surfaces a banner message when refresh fails but cache exists", async () => {
    const { adapters, storage, api } = await createTestAdapters();
    const userId = (adapters.auth as InMemoryAuthAdapter).currentSession
      ?.userId;
    if (!userId) throw new Error("expected a signed-in session");
    storage.cacheProfilePage(userId, makeProfilePagePayload());
    // Force the cache to look stale so the container fires a refresh.
    api.shouldFail = true;
    api.profilePage = makeProfilePagePayload();

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    // Manually trigger refresh — cache write above is fresh enough that
    // the auto-refresh path won't fire.
    await act(async () => {
      fireEvent.press(getByTestId("stub-refresh"));
    });

    await waitFor(() => {
      expect(getByTestId("stub-error").props.children).toContain("cached");
    });
  });

  it("prompts on sign-out via Alert and signs out on confirm", async () => {
    const { adapters, storage } = await createTestAdapters();
    storage.cacheExercises([
      {
        id: "a",
        name: "Cached",
        description: null,
        instructions: null,
        category: "strength",
        difficulty: "beginner",
        primaryMuscleGroups: ["chest"],
        secondaryMuscleGroups: [],
        equipment: ["barbell"],
        videoUrl: null,
        thumbnailUrl: null,
        isCustom: false,
        createdBy: null,
      },
    ]);

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("profile-presenter-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-sign-out"));
    });

    expect(alertSpy).toHaveBeenCalled();
    // Pull the destructive button out of the Alert call and fire it.
    const lastCall = alertSpy.mock.calls.at(-1);
    const buttons = lastCall?.[2] as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    const confirm = buttons?.find((b) => b.style === "destructive");
    expect(confirm).toBeTruthy();

    await act(async () => {
      confirm?.onPress?.();
    });

    await waitFor(() => {
      expect(getByTestId("stub-signing-out").props.children).toBe("false");
    });
    expect(storage.getCachedExercises().length).toBe(0);
  });

  it("surfaces a sign-out error when auth.signOut fails", async () => {
    const { adapters, auth } = await createTestAdapters();
    auth.shouldFail = true;

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("profile-presenter-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-sign-out"));
    });

    const lastCall = alertSpy.mock.calls.at(-1);
    const buttons = lastCall?.[2] as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    const confirm = buttons?.find((b) => b.style === "destructive");
    await act(async () => {
      confirm?.onPress?.();
    });

    await waitFor(() => {
      expect(getByTestId("stub-error").props.children).not.toBe("none");
    });
  });

  it("falls back to a generic message when sign-out throws a non-Error", async () => {
    const { adapters, auth } = await createTestAdapters();
    auth.signOut = async () => {
      throw "kaboom";
    };

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("profile-presenter-stub")).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-sign-out"));
    });

    const lastCall = alertSpy.mock.calls.at(-1);
    const buttons = lastCall?.[2] as {
      text: string;
      style?: string;
      onPress?: () => void;
    }[];
    const confirm = buttons?.find((b) => b.style === "destructive");
    await act(async () => {
      confirm?.onPress?.();
    });

    await waitFor(() => {
      expect(getByTestId("stub-error").props.children).toBe("Sign out failed");
    });
  });

  it("ignores a second sign-out tap while sign-out is in flight", async () => {
    const { adapters, auth } = await createTestAdapters();
    let resolveSignOut: (() => void) | null = null;
    const signOutCalls = jest.fn();
    auth.signOut = () =>
      new Promise((resolve) => {
        signOutCalls();
        resolveSignOut = () => resolve({ ok: true, value: undefined });
      });

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("profile-presenter-stub")).toBeTruthy();
    });

    // Confirm via Alert twice in the same event-loop turn.
    const fireConfirm = () => {
      const lastCall = alertSpy.mock.calls.at(-1);
      const buttons = lastCall?.[2] as {
        text: string;
        style?: string;
        onPress?: () => void;
      }[];
      buttons?.find((b) => b.style === "destructive")?.onPress?.();
    };

    await act(async () => {
      fireEvent.press(getByTestId("stub-sign-out"));
      fireConfirm();
      fireConfirm();
    });

    expect(signOutCalls).toHaveBeenCalledTimes(1);

    await act(async () => {
      if (resolveSignOut) resolveSignOut();
    });

    await waitFor(() => {
      expect(getByTestId("stub-signing-out").props.children).toBe("false");
    });
  });

  it("opens the Profile Picture sheet on avatar tap (no Remove option when avatar is null)", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("profile-presenter-stub")).toBeTruthy();
    });
    await act(async () => {
      fireEvent.press(getByTestId("stub-avatar"));
    });
    expect(alertSpy).toHaveBeenCalled();
    const lastCall = alertSpy.mock.calls.at(-1);
    expect(lastCall?.[0]).toBe("Profile Picture");
    expect(lastCall?.[1]).toBe("Choose an option");
    const buttons = lastCall?.[2] as { text: string; style?: string }[];
    expect(buttons.map((b) => b.text)).toEqual([
      "Camera",
      "Photo Library",
      "Cancel",
    ]);
    expect(
      buttons.find((b) => b.text === "Remove Profile Picture"),
    ).toBeUndefined();
  });

  it("includes Remove Profile Picture in the avatar sheet when avatar is set", async () => {
    const { adapters, api } = await createTestAdapters();
    api.profilePage = makeProfilePagePayload({
      profile: {
        id: "user-1",
        fullName: "Brad Simms",
        email: "brad@example.com",
        username: null,
        avatarUrl: "https://avatars/test/avatar.jpg",
        role: "user",
        fitnessLevel: null,
        heightCm: null,
        weightKg: null,
        preferredUnits: "metric",
        isProfilePublic: false,
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    });

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe("brad@example.com");
    });

    await act(async () => {
      fireEvent.press(getByTestId("stub-avatar"));
    });
    const lastCall = alertSpy.mock.calls.at(-1);
    const buttons = lastCall?.[2] as { text: string; style?: string }[];
    expect(buttons.map((b) => b.text)).toEqual([
      "Camera",
      "Photo Library",
      "Remove Profile Picture",
      "Cancel",
    ]);
    const remove = buttons.find((b) => b.text === "Remove Profile Picture");
    expect(remove?.style).toBe("destructive");
  });

  it("routes each menu item to its placeholder path", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("profile-presenter-stub")).toBeTruthy();
    });

    fireEvent.press(getByTestId("stub-edit-profile"));
    fireEvent.press(getByTestId("stub-health-data"));
    fireEvent.press(getByTestId("stub-notifications"));
    fireEvent.press(getByTestId("stub-notification-prefs"));
    fireEvent.press(getByTestId("stub-help-center"));
    fireEvent.press(getByTestId("stub-contact-support"));
    fireEvent.press(getByTestId("stub-terms"));
    fireEvent.press(getByTestId("stub-privacy"));

    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/edit");
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/health");
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/notifications");
    expect(mockPush).toHaveBeenCalledWith(
      "/(app)/profile/notifications/preferences",
    );
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/help");
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/contact");
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/terms");
    expect(mockPush).toHaveBeenCalledWith("/(app)/profile/privacy");
  });

  it("opens alerts for subscription + become-trainer handlers", async () => {
    const { adapters } = await createTestAdapters();
    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );
    await waitFor(() => {
      expect(getByTestId("profile-presenter-stub")).toBeTruthy();
    });
    fireEvent.press(getByTestId("stub-upgrade"));
    fireEvent.press(getByTestId("stub-manage-sub"));
    fireEvent.press(getByTestId("stub-become-trainer"));
    expect(alertSpy).toHaveBeenCalled();
  });
});
