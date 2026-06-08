import { fireEvent, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Linking, Pressable, Text, View } from "react-native";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { NotificationPreferencesPresenter } from "@/ui/presenters/NotificationPreferencesPresenter";
import { NotificationPreferencesContainer } from "../NotificationPreferencesContainer";

jest.mock("@/ui/presenters/NotificationPreferencesPresenter");
const MockPresenter = jest.mocked(NotificationPreferencesPresenter);

MockPresenter.mockImplementation((props) => (
  <View>
    <Text testID="granted">{String(props.permissionGranted)}</Text>
    <Text testID="prefs">{JSON.stringify(props.preferences)}</Text>
    <Pressable
      testID="toggle"
      onPress={() => props.onToggle("goal_milestone", false)}
    />
    <Pressable testID="open-settings" onPress={() => props.onOpenSettings()} />
    <Pressable testID="back" onPress={() => props.onBack()} />
  </View>
));

const mockBack = jest.fn();
jest.mock("expo-router", () => ({
  useRouter: () => ({ back: mockBack, push: jest.fn() }),
}));

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  permission: "granted" | "denied" | "not_determined",
): Adapters {
  return {
    api,
    storage,
    auth: {} as Adapters["auth"],
    health: {} as Adapters["health"],
    payments: {} as Adapters["payments"],
    notifications: {
      getPermissionStatus: jest.fn(async () => permission),
    } as unknown as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  } as Adapters;
}

function renderContainer(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
  permission: "granted" | "denied" | "not_determined" = "granted",
) {
  const adapters = makeAdapters(api, storage, permission);
  return render(<NotificationPreferencesContainer />, {
    wrapper: ({ children }: { children: ReactNode }) => (
      <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
    ),
  });
}

beforeEach(() => {
  mockBack.mockClear();
  jest.spyOn(Linking, "openSettings").mockResolvedValue(undefined);
});

describe("NotificationPreferencesContainer", () => {
  it("does NOT write defaults on first open — no destructive POST (Inspector)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Brand-new user: the server has no prefs row yet (empty map).
    api.notificationPreferences = {};

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() =>
      expect(JSON.parse(getByTestId("prefs").props.children)).toEqual({}),
    );
    // Nothing enqueued — the old all-true DEFAULT_OPT_IN write is gone;
    // an empty map already reads as "all on" via isTypeEnabled.
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("hydrates existing server prefs on reinstall instead of clobbering them (Inspector)", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    // Reinstall / data-wipe: local cache empty, but the user previously
    // DISABLED a category on the server. The container must not re-enable it.
    api.notificationPreferences = { goal_milestone: false };

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() =>
      expect(JSON.parse(getByTestId("prefs").props.children)).toEqual({
        goal_milestone: false,
      }),
    );
    // No destructive all-true POST that would flip goal_milestone back on.
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("refreshes from the server (no default write) when a cache already exists", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotificationPreferences({ workout_assigned: true });
    api.notificationPreferences = { workout_assigned: false };

    const { getByTestId } = renderContainer(api, storage);

    await waitFor(() =>
      expect(JSON.parse(getByTestId("prefs").props.children)).toEqual({
        workout_assigned: false,
      }),
    );
    // no first-open default write enqueued
    expect(storage.getPendingMutations()).toHaveLength(0);
  });

  it("toggles optimistically and enqueues the partial POST", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotificationPreferences({ goal_milestone: true });

    const { getByTestId } = renderContainer(api, storage);
    fireEvent.press(getByTestId("toggle"));

    await waitFor(() =>
      expect(
        JSON.parse(getByTestId("prefs").props.children).goal_milestone,
      ).toBe(false),
    );
    const partial = storage
      .getPendingMutations()
      .map((m) => JSON.parse(m.payload));
    expect(partial).toContainEqual({ goal_milestone: false });
  });

  it("surfaces permission-off to the presenter", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { getByTestId } = renderContainer(api, storage, "denied");
    await waitFor(() =>
      expect(getByTestId("granted").props.children).toBe("false"),
    );
  });

  it("opens device settings from the banner handler", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { getByTestId } = renderContainer(api, storage, "denied");
    fireEvent.press(getByTestId("open-settings"));
    expect(Linking.openSettings).toHaveBeenCalledTimes(1);
  });

  it("keeps the cached prefs when a refresh fails", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotificationPreferences({ workout_assigned: true });
    api.shouldFail = true;

    const { getByTestId } = renderContainer(api, storage);
    await waitFor(() =>
      expect(getByTestId("granted").props.children).toBe("true"),
    );
    expect(JSON.parse(getByTestId("prefs").props.children)).toEqual({
      workout_assigned: true,
    });
  });

  it("cancels pending async work on unmount", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    storage.cacheNotificationPreferences({ workout_assigned: true });

    const { unmount } = renderContainer(api, storage);
    unmount();
    // let the in-flight refresh + permission reads resolve post-unmount;
    // the `cancelled` guard short-circuits their setState
    await new Promise((r) => setTimeout(r, 0));
  });

  it("navigates back", async () => {
    const api = new InMemoryApiAdapter();
    const storage = new InMemoryStorageAdapter();
    const { getByTestId } = renderContainer(api, storage);
    fireEvent.press(getByTestId("back"));
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
