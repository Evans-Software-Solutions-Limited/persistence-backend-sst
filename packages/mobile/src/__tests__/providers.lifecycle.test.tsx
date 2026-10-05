import React from "react";
import { Text } from "react-native";
import { act, render } from "@testing-library/react-native";
import Constants from "expo-constants";
import { AppProviders } from "@/providers";
import { useAdapters, useStorageStatus } from "@/ui/hooks/useAdapters";
import { createTogetherProvisioning } from "@/adapters/together/createTogetherProvisioning";
import { captureStorageInitFailure } from "@/lib/sentry";

jest.mock("expo-constants", () => ({
  __esModule: true,
  default: { expoConfig: { extra: {} } },
}));

const mockInitialize = jest.fn();
const mockChanged = jest.fn();
const mockDestroy = jest.fn();
const mockClear = jest.fn();
const mockToken = jest.fn();
const mockSetToken = jest.fn();
const mockPrepare = jest.fn();
const mockAccount = jest.fn();
const mockAuthUnsubscribe = jest.fn();
const mockNetworkUnsubscribe = jest.fn();
let mockAuthListener: (
  session: { userId: string } | null,
  event: string,
) => void;
let mockNetworkListener: (online: boolean) => void;
const userId = "00000000-0000-4000-8000-000000000001";
jest.mock("@/adapters/api", () => ({
  SSTApiAdapter: jest.fn().mockImplementation(() => ({
    setTokenProvider: mockSetToken,
    togetherOffline: { trust: "trust" },
  })),
  getApiBaseUrl: () => "https://api.example",
}));
jest.mock("@/adapters/auth", () => ({
  SupabaseAuthAdapter: jest.fn().mockImplementation(() => ({
    getAccessToken: mockToken,
    getPersistedSession: async () => ({ userId }),
    onAuthStateChange: (listener: typeof mockAuthListener) => {
      mockAuthListener = listener;
      return mockAuthUnsubscribe;
    },
    destroy: mockDestroy,
    clearLocalSession: mockClear,
  })),
}));
jest.mock("@/adapters/storage", () => ({
  SQLiteStorageAdapter: jest.fn().mockImplementation(() => ({
    initialize: mockInitialize,
    backendChanged: mockChanged,
  })),
}));
jest.mock("@/adapters/netInfo", () => ({
  RNNetInfoAdapter: jest.fn().mockImplementation(() => ({
    isConnected: async () => true,
    subscribe: (listener: typeof mockNetworkListener) => {
      mockNetworkListener = listener;
      return mockNetworkUnsubscribe;
    },
  })),
}));
jest.mock("@/adapters/health", () => ({ createHealthAdapter: () => ({}) }));
jest.mock("@/adapters/notifications", () => ({
  ExpoNotificationsAdapter: jest.fn(),
}));
jest.mock("@/adapters/together/createTogetherProvisioning", () => ({
  createTogetherProvisioning: jest.fn(),
}));
jest.mock("@/lib/sentry", () => ({ captureStorageInitFailure: jest.fn() }));
jest.mock("@/ui/theme", () => ({
  ThemeProvider: ({ children }: { children: React.ReactNode }) => children,
}));
jest.mock("@/ui/state/OnboardingProvider", () => ({
  OnboardingProvider: ({ children }: { children: React.ReactNode }) => children,
}));
function Probe() {
  const adapters = useAdapters();
  const status = useStorageStatus();
  return (
    <Text testID="state">{`${status.error?.message ?? "ready"}:${!!adapters.togetherProvisioning}`}</Text>
  );
}
const flush = async () => {
  await act(async () => {
    for (let i = 0; i < 12; i++) await Promise.resolve();
  });
};
const originalConfig = Constants.expoConfig;
const originalEnv = process.env.EXPO_PUBLIC_SUPABASE_URL;
beforeEach(() => {
  jest.clearAllMocks();
  mockInitialize.mockReset().mockResolvedValue(undefined);
  mockChanged.mockReturnValue(false);
  mockClear.mockResolvedValue(undefined);
  mockToken.mockResolvedValue("current-token");
  mockPrepare.mockResolvedValue({ ok: false, error: { code: "unavailable" } });
  jest.mocked(createTogetherProvisioning).mockReturnValue(undefined);
});
afterEach(() => {
  Constants.expoConfig = originalConfig;
  if (originalEnv === undefined) delete process.env.EXPO_PUBLIC_SUPABASE_URL;
  else process.env.EXPO_PUBLIC_SUPABASE_URL = originalEnv;
});
it("withholds children until storage is ready and composes release Together services", async () => {
  let resolve!: () => void;
  mockInitialize.mockReturnValue(
    new Promise<void>((r) => {
      resolve = r;
    }),
  );
  Constants.expoConfig = {
    ...originalConfig!,
    extra: { supabaseUrl: "https://auth.example" },
  };
  const view = render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
  expect(view.queryByTestId("state")).toBeNull();
  expect(mockInitialize).toHaveBeenCalledWith("https://auth.example");
  expect(createTogetherProvisioning).toHaveBeenCalledWith(
    { trust: "trust" },
    "https://api.example",
    true,
  );
  expect(await mockSetToken.mock.calls[0][0]()).toBe("current-token");
  resolve();
  await flush();
  expect(view.getByTestId("state").props.children).toBe("ready:false");
  view.rerender(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
  expect(createTogetherProvisioning).toHaveBeenCalledTimes(1);
  view.unmount();
  expect(mockDestroy).toHaveBeenCalledTimes(1);
});
it("binds the optional service to account, connectivity and unmount without exposing keys", async () => {
  jest.mocked(createTogetherProvisioning).mockReturnValue({
    setAccount: mockAccount,
    prepare: mockPrepare,
    friendship: jest.fn(),
    dispose: jest.fn(),
  });
  const view = render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
  await flush();
  expect(view.getByTestId("state").props.children).toBe("ready:true");
  expect(mockAccount).toHaveBeenCalledWith(userId);
  expect(mockPrepare).toHaveBeenCalledWith({ online: true });
  mockNetworkListener(false);
  await flush();
  expect(mockPrepare).toHaveBeenLastCalledWith({ online: false });
  mockAuthListener(null, "SIGNED_OUT");
  expect(mockAccount).toHaveBeenLastCalledWith(null);
  view.unmount();
  expect(mockAuthUnsubscribe).toHaveBeenCalledTimes(1);
  expect(mockNetworkUnsubscribe).toHaveBeenCalledTimes(1);
});
it("clears the old local session after a backend change before releasing children", async () => {
  Constants.expoConfig = null;
  process.env.EXPO_PUBLIC_SUPABASE_URL = "https://env.example";
  mockChanged.mockReturnValue(true);
  const view = render(
    <AppProviders>
      <Probe />
    </AppProviders>,
  );
  await flush();
  expect(mockInitialize).toHaveBeenCalledWith("https://env.example");
  expect(mockClear).toHaveBeenCalledTimes(1);
  expect(view.getByTestId("state").props.children).toBe("ready:false");
});
it.each([new Error("broken cache"), "disk full"])(
  "reports storage failure and releases a degraded tree: %s",
  async (error) => {
    Constants.expoConfig = null;
    delete process.env.EXPO_PUBLIC_SUPABASE_URL;
    mockInitialize.mockRejectedValue(error);
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = render(
        <AppProviders>
          <Probe />
        </AppProviders>,
      );
      await flush();
      expect(mockInitialize).toHaveBeenCalledWith("");
      expect(captureStorageInitFailure).toHaveBeenCalledWith(error);
      expect(view.getByTestId("state").props.children).toBe(
        `${error instanceof Error ? error.message : error}:false`,
      );
    } finally {
      log.mockRestore();
    }
  },
);
it.each([false, true])(
  "ignores storage completion after unmount (reject=%s)",
  async (reject) => {
    let settle!: () => void;
    mockInitialize.mockReturnValue(
      new Promise<void>((resolve, fail) => {
        settle = () => (reject ? fail(new Error("late")) : resolve());
      }),
    );
    const log = jest.spyOn(console, "error").mockImplementation(() => {});
    try {
      const view = render(
        <AppProviders>
          <Probe />
        </AppProviders>,
      );
      view.unmount();
      settle();
      await flush();
      expect(mockDestroy).toHaveBeenCalledTimes(1);
      if (reject)
        expect(captureStorageInitFailure).toHaveBeenCalledWith(
          new Error("late"),
        );
    } finally {
      log.mockRestore();
    }
  },
);
