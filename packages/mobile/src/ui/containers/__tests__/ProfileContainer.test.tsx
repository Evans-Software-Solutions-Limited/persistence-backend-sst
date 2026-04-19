import { act, fireEvent, render, waitFor } from "@testing-library/react-native";
import { TamaguiProvider } from "@tamagui/core";
import type { ReactNode } from "react";
import { Pressable, Text, View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryAuthAdapter } from "@/adapters/auth/__tests__/in-memory-auth.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { StubHealthAdapter } from "@/adapters/health";
import { StubNotificationsAdapter } from "@/adapters/notifications";
import { StubPaymentsAdapter } from "@/adapters/payments";
import type { Adapters } from "@/shared/types";
import { ProfilePresenter } from "@/ui/presenters/ProfilePresenter";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import config from "../../../../tamagui.config";
import { ProfileContainer } from "../ProfileContainer";

jest.setTimeout(15_000);

jest.mock("@/ui/presenters/ProfilePresenter");
const MockPresenter = jest.mocked(ProfilePresenter);

let lastProps: Parameters<typeof ProfilePresenter>[0] | null = null;

MockPresenter.mockImplementation((props) => {
  lastProps = props;
  return (
    <View testID="profile-presenter-stub">
      <Text testID="stub-email">{props.email ?? "none"}</Text>
      <Text testID="stub-signing-out">
        {props.isSigningOut ? "true" : "false"}
      </Text>
      <Text testID="stub-error">{props.error ?? "none"}</Text>
      <Pressable
        testID="stub-sign-out"
        onPress={() => {
          props.onSignOut();
        }}
      />
    </View>
  );
});

async function createTestAdapters(): Promise<{
  adapters: Adapters;
  auth: InMemoryAuthAdapter;
  storage: InMemoryStorageAdapter;
}> {
  const auth = new InMemoryAuthAdapter();
  // Seed a signed-in session so the hook exposes an email to the presenter.
  await auth.signInWithEmail("lifter@example.com", "password");
  const adapters: Adapters = {
    api: new InMemoryApiAdapter(),
    auth,
    storage: new InMemoryStorageAdapter(),
    health: new StubHealthAdapter(),
    notifications: new StubNotificationsAdapter(),
    payments: new StubPaymentsAdapter(),
  };
  return {
    adapters,
    auth,
    storage: adapters.storage as InMemoryStorageAdapter,
  };
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
  beforeEach(() => {
    jest.clearAllMocks();
    lastProps = null;
  });

  it("forwards the authenticated session email to the presenter", async () => {
    const { adapters } = await createTestAdapters();

    const { getByTestId } = render(
      <TestWrapper adapters={adapters}>
        <ProfileContainer />
      </TestWrapper>,
    );

    await waitFor(() => {
      expect(getByTestId("stub-email").props.children).toBe(
        "lifter@example.com",
      );
    });
    expect(lastProps?.displayName).toBeNull();
    expect(lastProps?.avatarUrl).toBeNull();
  });

  it("signs out successfully and clears storage", async () => {
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

    await waitFor(() => {
      expect(getByTestId("stub-signing-out").props.children).toBe("false");
    });
    expect(storage.getCachedExercises().length).toBe(0);
    expect(getByTestId("stub-error").props.children).toBe("none");
  });

  it("surfaces an error when sign-out fails", async () => {
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

    await waitFor(() => {
      expect(getByTestId("stub-error").props.children).toBe("Sign out failed");
    });
  });

  it("ignores a second press while sign-out is in flight", async () => {
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

    // Two taps in the SAME event-loop turn. A state-based guard would fail
    // here because React batches the setIsSigningOut(true) update — the
    // second call's closure still sees isSigningOut === false. The ref-based
    // guard mutates synchronously, so the second tap returns immediately.
    await act(async () => {
      fireEvent.press(getByTestId("stub-sign-out"));
      fireEvent.press(getByTestId("stub-sign-out"));
    });

    expect(signOutCalls).toHaveBeenCalledTimes(1);

    await act(async () => {
      if (resolveSignOut) resolveSignOut();
    });

    await waitFor(() => {
      expect(getByTestId("stub-signing-out").props.children).toBe("false");
    });
  });
});
