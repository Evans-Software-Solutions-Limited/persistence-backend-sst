import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useAvatarUpload } from "@/ui/hooks/useAvatarUpload";

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

const mockedPicker = ImagePicker as jest.Mocked<typeof ImagePicker>;
const mockedManipulator = ImageManipulator as jest.Mocked<
  typeof ImageManipulator
>;

function makeAdapters(
  api: InMemoryApiAdapter,
  storage: InMemoryStorageAdapter,
): Adapters {
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
    email: "u@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    signInWithEmail: jest.fn(),
    signUpWithEmail: jest.fn(),
    signInWithOAuth: jest.fn(),
    signOut: jest.fn(),
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    resetPassword: jest.fn(),
    refreshSession: jest.fn(),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    payments: {} as Adapters["payments"],
  };
}

function wrap(adapters: Adapters) {
  function Wrapper({ children }: { children: ReactNode }) {
    return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
  }
  return Wrapper;
}

function setupHook(opts: { avatarUrl: string | null }) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const invalidateSpy = jest.spyOn(storage, "invalidateProfilePage");
  const adapters = makeAdapters(api, storage);
  const { result } = renderHook(() => useAvatarUpload(opts.avatarUrl), {
    wrapper: wrap(adapters),
  });
  return { result, api, storage, invalidateSpy };
}

function fireSheetButton(buttonText: string, alertSpy: jest.SpyInstance) {
  const lastCall = alertSpy.mock.calls.at(-1);
  const buttons = lastCall?.[2] as {
    text: string;
    onPress?: () => void;
  }[];
  const btn = buttons?.find((b) => b.text === buttonText);
  if (!btn?.onPress) throw new Error(`No button "${buttonText}"`);
  btn.onPress();
}

describe("useAvatarUpload", () => {
  let alertSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    alertSpy = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    // Sensible defaults — overridden per-test.
    mockedManipulator.manipulateAsync.mockResolvedValue({
      uri: "file:///resized.jpg",
      width: 512,
      height: 512,
    } as Awaited<ReturnType<typeof ImageManipulator.manipulateAsync>>);
  });

  afterEach(() => {
    alertSpy.mockRestore();
  });

  it("initialises with cacheKey 0 and isWorking false", () => {
    const { result } = setupHook({ avatarUrl: null });
    expect(result.current.cacheKey).toBe(0);
    expect(result.current.isWorking).toBe(false);
    expect(typeof result.current.showAvatarSheet).toBe("function");
  });

  it("opens the sheet without Remove when avatarUrl is null", () => {
    const { result } = setupHook({ avatarUrl: null });
    act(() => {
      result.current.showAvatarSheet();
    });
    expect(alertSpy).toHaveBeenCalledTimes(1);
    const buttons = alertSpy.mock.calls[0][2] as { text: string }[];
    expect(buttons.map((b) => b.text)).toEqual([
      "Camera",
      "Photo Library",
      "Cancel",
    ]);
  });

  it("opens the sheet with Remove when avatarUrl is present", () => {
    const { result } = setupHook({
      avatarUrl: "https://avatars/u/avatar.jpg",
    });
    act(() => {
      result.current.showAvatarSheet();
    });
    const buttons = alertSpy.mock.calls[0][2] as {
      text: string;
      style?: string;
    }[];
    expect(buttons.map((b) => b.text)).toEqual([
      "Camera",
      "Photo Library",
      "Remove Profile Picture",
      "Cancel",
    ]);
    expect(
      buttons.find((b) => b.text === "Remove Profile Picture")?.style,
    ).toBe("destructive");
  });

  it("Camera path: requests permission, picks, resizes, uploads, bumps cacheKey", async () => {
    mockedPicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: true,
    } as Awaited<ReturnType<typeof ImagePicker.requestCameraPermissionsAsync>>);
    mockedPicker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///picked.jpg" }],
    } as Awaited<ReturnType<typeof ImagePicker.launchCameraAsync>>);

    const { result, api, invalidateSpy } = setupHook({ avatarUrl: null });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Camera", alertSpy);
    });

    await waitFor(() => {
      expect(result.current.cacheKey).toBe(1);
    });
    expect(mockedManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file:///picked.jpg",
      [{ resize: { width: 512, height: 512 } }],
      expect.objectContaining({ compress: 0.8, format: "jpeg" }),
    );
    expect(api.uploadAvatarCalls).toEqual([
      {
        uri: "file:///resized.jpg",
        mimeType: "image/jpeg",
        name: "avatar.jpg",
      },
    ]);
    expect(invalidateSpy).toHaveBeenCalledWith("user-1");
  });

  it("Library path: requests permission, picks, uploads, bumps cacheKey", async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as Awaited<
      ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>
    >);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///gallery.jpg" }],
    } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>);

    const { result, api } = setupHook({ avatarUrl: null });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Photo Library", alertSpy);
    });

    await waitFor(() => {
      expect(result.current.cacheKey).toBe(1);
    });
    expect(api.uploadAvatarCalls).toHaveLength(1);
    expect(api.uploadAvatarCalls[0]?.uri).toBe("file:///resized.jpg");
  });

  it("alerts and skips upload when camera permission is denied", async () => {
    mockedPicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
    } as Awaited<ReturnType<typeof ImagePicker.requestCameraPermissionsAsync>>);

    const { result, api } = setupHook({ avatarUrl: null });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Camera", alertSpy);
    });

    await waitFor(() => {
      // Second Alert call is the permission denial. First is the sheet.
      expect(alertSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    const denialCall = alertSpy.mock.calls.at(-1);
    expect(denialCall?.[0]).toBe("Permission required");
    expect(api.uploadAvatarCalls).toHaveLength(0);
    expect(mockedPicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(result.current.cacheKey).toBe(0);
  });

  it("alerts and skips upload when photo-library permission is denied", async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
    } as Awaited<
      ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>
    >);

    const { result, api } = setupHook({ avatarUrl: null });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Photo Library", alertSpy);
    });

    await waitFor(() => {
      expect(alertSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    });
    expect(api.uploadAvatarCalls).toHaveLength(0);
    expect(result.current.cacheKey).toBe(0);
  });

  it("no-ops when the picker is canceled", async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as Awaited<
      ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>
    >);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
      assets: null,
    } as unknown as Awaited<
      ReturnType<typeof ImagePicker.launchImageLibraryAsync>
    >);

    const { result, api } = setupHook({ avatarUrl: null });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Photo Library", alertSpy);
    });

    // Let pending microtasks settle so isWorking flips back.
    await waitFor(() => {
      expect(result.current.isWorking).toBe(false);
    });
    expect(mockedManipulator.manipulateAsync).not.toHaveBeenCalled();
    expect(api.uploadAvatarCalls).toHaveLength(0);
    expect(result.current.cacheKey).toBe(0);
  });

  it("Remove path: calls deleteAvatar, bumps cacheKey, invalidates cache", async () => {
    const { result, api, invalidateSpy } = setupHook({
      avatarUrl: "https://avatars/u/avatar.jpg",
    });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Remove Profile Picture", alertSpy);
    });

    await waitFor(() => {
      expect(result.current.cacheKey).toBe(1);
    });
    expect(api.deleteAvatarCalls).toBe(1);
    expect(invalidateSpy).toHaveBeenCalledWith("user-1");
  });

  it("surfaces an alert and does not bump cacheKey when upload fails", async () => {
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as Awaited<
      ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>
    >);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///gallery.jpg" }],
    } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>);

    const { result, api } = setupHook({ avatarUrl: null });
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "server",
      message: "boom",
    };

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Photo Library", alertSpy);
    });

    await waitFor(() => {
      const failureCall = alertSpy.mock.calls.find(
        (c) => c[0] === "Upload failed",
      );
      expect(failureCall).toBeTruthy();
    });
    expect(result.current.cacheKey).toBe(0);
  });

  it("surfaces an alert and does not bump cacheKey when remove fails", async () => {
    const { result, api } = setupHook({
      avatarUrl: "https://avatars/u/avatar.jpg",
    });
    api.shouldFail = true;
    api.failError = {
      kind: "api",
      code: "server",
      message: "boom",
    };

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Remove Profile Picture", alertSpy);
    });

    await waitFor(() => {
      const failureCall = alertSpy.mock.calls.find(
        (c) => c[0] === "Remove failed",
      );
      expect(failureCall).toBeTruthy();
    });
    expect(result.current.cacheKey).toBe(0);
  });

  it("alerts with a fallback when expo-image-manipulator rejects (native throw)", async () => {
    // Inspector Brad PR #68: native module rejections from picker / manipulator
    // used to escape the hook because `run` was try/finally with no catch —
    // user got a silent no-op + an unhandled-promise warning. Pin both the
    // alert AND that we don't bump cacheKey on this failure.
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as Awaited<
      ReturnType<typeof ImagePicker.requestMediaLibraryPermissionsAsync>
    >);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///gallery.jpg" }],
    } as Awaited<ReturnType<typeof ImagePicker.launchImageLibraryAsync>>);
    mockedManipulator.manipulateAsync.mockRejectedValueOnce(
      new Error("ImageManipulator: invalid input"),
    );

    const { result, api } = setupHook({ avatarUrl: null });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Photo Library", alertSpy);
    });

    await waitFor(() => {
      const fallbackCall = alertSpy.mock.calls.find(
        (c) => c[0] === "Something went wrong",
      );
      expect(fallbackCall).toBeTruthy();
    });
    expect(api.uploadAvatarCalls).toHaveLength(0);
    expect(result.current.cacheKey).toBe(0);
    expect(result.current.isWorking).toBe(false);
    warnSpy.mockRestore();
  });

  it("alerts with a fallback when expo-image-picker rejects (native throw)", async () => {
    const warnSpy = jest.spyOn(console, "warn").mockImplementation(() => {});
    mockedPicker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: true,
    } as Awaited<ReturnType<typeof ImagePicker.requestCameraPermissionsAsync>>);
    mockedPicker.launchCameraAsync.mockRejectedValueOnce(
      new Error("Camera not available"),
    );

    const { result } = setupHook({ avatarUrl: null });

    await act(async () => {
      result.current.showAvatarSheet();
      fireSheetButton("Camera", alertSpy);
    });

    await waitFor(() => {
      const fallbackCall = alertSpy.mock.calls.find(
        (c) => c[0] === "Something went wrong",
      );
      expect(fallbackCall).toBeTruthy();
    });
    expect(result.current.cacheKey).toBe(0);
    expect(result.current.isWorking).toBe(false);
    warnSpy.mockRestore();
  });
});
