import { act, renderHook, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { Alert, AppState } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import { savePendingProgressPhotosCommand } from "@/application/commands/progressPhotos.command";
import type { AuthSession } from "@/domain/ports/auth.port";
import type { PendingProgressPhoto } from "@/domain/models/progressPhotos";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { useProgressPhotos } from "@/ui/hooks/useProgressPhotos";
import {
  PHOTO_UPLOAD_MIN_WAIT_MS,
  useProgressPhotoUploadWorker,
} from "@/ui/hooks/useProgressPhotoUploadWorker";
import {
  prepareProgressPhoto,
  useProgressPhotoCapture,
} from "@/ui/hooks/useProgressPhotoCapture";

const mockProcessSyncQueue = jest.fn(async () => ({}));
const mockUploads = jest.fn(async (..._a: unknown[]) => ({
  uploaded: 0,
  retrying: 0,
  failed: 0,
}));
jest.mock("@/application/commands/sync.command", () => ({
  ...jest.requireActual("@/application/commands/sync.command"),
  processSyncQueue: (...a: unknown[]) => mockProcessSyncQueue(...(a as [])),
  processProgressPhotoUploads: (...a: unknown[]) => mockUploads(...a),
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
jest.mock("expo-image-manipulator", () => ({
  manipulateAsync: jest.fn(),
  SaveFormat: { JPEG: "jpeg" },
}));
jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));
const mockPermissionQueue = jest.fn((fn: () => Promise<unknown>) => fn());
jest.mock("@/lib/nativePermissionQueue", () => ({
  runNativePermissionRequest: (fn: () => Promise<unknown>) =>
    mockPermissionQueue(fn),
}));

const USER = "athlete-1";

function setup(signedIn = true, connected: () => boolean = () => true) {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@example.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(signedIn ? session : null)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(signedIn ? session : null);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  const netListeners: ((c: boolean) => void)[] = [];
  const netInfo = {
    isConnected: jest.fn(async () => connected()),
    subscribe: jest.fn((cb: (c: boolean) => void) => {
      netListeners.push(cb);
      return () => {
        netListeners.splice(netListeners.indexOf(cb), 1);
      };
    }),
  } as unknown as Adapters["netInfo"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo,
  };
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AdapterProvider adapters={adapters}>{children}</AdapterProvider>
  );
  return { api, storage, wrapper, netListeners };
}

function photo(pose: PendingProgressPhoto["pose"]): PendingProgressPhoto {
  return { pose, uri: `file:///c/${pose}.jpg`, bytes: 4, width: 1, height: 1 };
}

beforeEach(() => {
  jest.clearAllMocks();
});

describe("useProgressPhotos", () => {
  it("reads the server gallery and merges sets still on the phone", async () => {
    const { api, storage, wrapper } = setup();
    api.progressPhotoSets = [
      {
        id: "s1",
        takenOn: "2026-10-25",
        source: "self",
        status: "ready",
        createdAt: "2026-10-25T09:00:00.000Z",
        updatedAt: "2026-10-25T09:00:00.000Z",
        photos: [],
        weight: { kg: 82.4, measuredAt: "x" },
        bodyFat: null,
      },
    ];
    savePendingProgressPhotosCommand(storage, USER, {
      takenOn: "2026-11-25",
      photos: [photo("front"), photo("side"), photo("back")],
    });
    const { result } = renderHook(() => useProgressPhotos(), { wrapper });
    await waitFor(() => expect(result.current.sets).toHaveLength(2));
    expect(result.current.sets.map((s) => s.upload)).toEqual([
      "uploading",
      "done",
    ]);
    expect(storage.getCachedProgressPhotos(USER)?.sets).toHaveLength(1);

    // A set saved elsewhere shows after a local re-read, with no network.
    savePendingProgressPhotosCommand(storage, USER, {
      takenOn: "2026-11-26",
      photos: [photo("front"), photo("side"), photo("back")],
    });
    act(() => result.current.reloadAll());
    expect(result.current.sets).toHaveLength(3);
  });

  it("is empty when signed out", () => {
    const { wrapper } = setup(false);
    const { result } = renderHook(() => useProgressPhotos(), { wrapper });
    expect(result.current.sets).toEqual([]);
    expect(result.current.pending).toEqual([]);
  });

  it("keeps the cache when the read fails", async () => {
    const { api, wrapper } = setup();
    api.progressPhotoFailures.list.push(
      { kind: "api", code: "network", message: "offline" },
      { kind: "api", code: "network", message: "offline" },
      { kind: "api", code: "network", message: "offline" },
    );
    const { result } = renderHook(() => useProgressPhotos(), { wrapper });
    await waitFor(() => expect(result.current.error?.code).toBe("network"), {
      timeout: 8000,
    });
    expect(result.current.sets).toEqual([]);
  });
});

describe("useProgressPhotoUploadWorker", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("runs a pass on mount, on foreground, on reconnect, and when a retry is due", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-11-25T10:00:00.000Z") });
    const appListeners: ((s: string) => void)[] = [];
    const remove = jest.fn();
    jest.spyOn(AppState, "addEventListener").mockImplementation((_t, cb) => {
      appListeners.push(cb as (s: string) => void);
      return { remove } as never;
    });
    const { storage, wrapper, netListeners } = setup();
    const row = savePendingProgressPhotosCommand(
      storage,
      USER,
      {
        takenOn: "2026-11-25",
        photos: [photo("front"), photo("side"), photo("back")],
      },
      new Date(),
    );
    storage.savePendingProgressPhotoSet({
      ...row,
      nextAttemptAt: new Date(Date.now() + 30_000).toISOString(),
    });
    // A failed set never schedules a timer of its own.
    storage.savePendingProgressPhotoSet({
      ...row,
      id: "local-dead",
      failed: "rejected",
      nextAttemptAt: new Date(Date.now()).toISOString(),
    });

    const { unmount } = renderHook(() => useProgressPhotoUploadWorker(), {
      wrapper,
    });
    await act(async () => {});
    expect(mockUploads).toHaveBeenCalledTimes(1);
    expect(mockUploads.mock.calls[0]?.[2]).toBe(USER);

    await act(async () => {
      appListeners[0]!("background");
      appListeners[0]!("active");
    });
    expect(mockUploads).toHaveBeenCalledTimes(2);

    await act(async () => {
      netListeners[0]!(false);
      netListeners[0]!(true);
    });
    expect(mockUploads).toHaveBeenCalledTimes(3);

    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(mockUploads).toHaveBeenCalledTimes(4);

    unmount();
    expect(remove).toHaveBeenCalled();
    expect(netListeners).toHaveLength(0);
  });

  it("waits at least a second, survives a failed pass, and does nothing signed out", async () => {
    jest.useFakeTimers({ now: Date.parse("2026-11-25T10:00:00.000Z") });
    const { storage, wrapper } = setup();
    savePendingProgressPhotosCommand(
      storage,
      USER,
      {
        takenOn: "2026-11-25",
        photos: [photo("front"), photo("side"), photo("back")],
      },
      new Date(Date.now() - 60_000),
    );
    const error = jest.spyOn(console, "error").mockImplementation(() => {});
    mockUploads.mockRejectedValueOnce(new Error("boom"));
    const { unmount } = renderHook(() => useProgressPhotoUploadWorker(), {
      wrapper,
    });
    await act(async () => {});
    expect(error).toHaveBeenCalled();
    await act(async () => {
      jest.advanceTimersByTime(PHOTO_UPLOAD_MIN_WAIT_MS - 1);
    });
    expect(mockUploads).toHaveBeenCalledTimes(1);
    await act(async () => {
      jest.advanceTimersByTime(1);
    });
    expect(mockUploads).toHaveBeenCalledTimes(2);
    unmount();
    error.mockRestore();

    const signedOut = setup(false);
    renderHook(() => useProgressPhotoUploadWorker(), {
      wrapper: signedOut.wrapper,
    });
    await act(async () => {});
    expect(mockUploads).toHaveBeenCalledTimes(2);
  });
});

describe("useProgressPhotoUploadWorker offline", () => {
  it("uploads nothing while offline, then runs on reconnect", async () => {
    let online = false;
    const { storage, wrapper, netListeners } = setup(true, () => online);
    savePendingProgressPhotosCommand(storage, USER, {
      takenOn: "2026-11-25",
      photos: [photo("front"), photo("side"), photo("back")],
    });
    renderHook(() => useProgressPhotoUploadWorker(), { wrapper });
    await act(async () => {});
    expect(mockUploads).not.toHaveBeenCalled();
    online = true;
    await act(async () => {
      netListeners[0]!(true);
    });
    expect(mockUploads).toHaveBeenCalledTimes(1);
  });
});

describe("prepareProgressPhoto / useProgressPhotoCapture", () => {
  const manipulate = ImageManipulator.manipulateAsync as jest.Mock;
  const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
  const readFile = jest.fn(async () => new Blob(["12345"]));

  it("converts to a JPEG with a 2048 px long edge and measures it", async () => {
    manipulate.mockResolvedValue({
      uri: "file:///out.jpg",
      width: 1536,
      height: 2048,
    });
    const out = await prepareProgressPhoto(
      "side",
      { uri: "file:///in.heic", width: 3024, height: 4032 },
      readFile,
    );
    expect(manipulate).toHaveBeenCalledWith(
      "file:///in.heic",
      [{ resize: { height: 2048 } }],
      { compress: 0.85, format: "jpeg" },
    );
    expect(out).toEqual({
      pose: "side",
      uri: "file:///out.jpg",
      bytes: 5,
      width: 1536,
      height: 2048,
    });
  });

  it("caps a photo with unknown size and keeps null dimensions", async () => {
    manipulate.mockResolvedValue({
      uri: "file:///out.jpg",
      width: 0,
      height: 0,
    });
    const out = await prepareProgressPhoto(
      "front",
      { uri: "file:///in" },
      readFile,
    );
    expect(manipulate.mock.calls[0]?.[1]).toEqual([
      { resize: { width: 2048 } },
    ]);
    expect(out.width).toBeNull();
    expect(out.height).toBeNull();
  });

  function answer(button: string) {
    return jest
      .spyOn(Alert, "alert")
      .mockImplementation((_t, _m, buttons, options) => {
        if (button === "dismiss") {
          options?.onDismiss?.();
          return;
        }
        buttons?.find((b) => b.text === button)?.onPress?.();
      });
  }

  it("takes a photo with the phone's camera", async () => {
    const { wrapper } = setup();
    answer("Camera");
    picker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    picker.launchCameraAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file:///cam.jpg", width: 100, height: 200 }],
    } as never);
    manipulate.mockResolvedValue({
      uri: "file:///out.jpg",
      width: 100,
      height: 200,
    });
    const fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      status: 200,
      blob: async () => new Blob(["ab"]),
    } as never);
    const { result } = renderHook(() => useProgressPhotoCapture(), { wrapper });
    const out = await result.current.capture("front");
    expect(out).toMatchObject({
      pose: "front",
      uri: "file:///out.jpg",
      bytes: 2,
    });
    // The permission prompt waits its turn in the shared native queue.
    expect(mockPermissionQueue).toHaveBeenCalledTimes(1);
    expect(picker.requestCameraPermissionsAsync).toHaveBeenCalledTimes(1);
    expect(picker.launchCameraAsync).toHaveBeenCalledWith({
      mediaTypes: ["images"],
      quality: 1,
    });
    fetchSpy.mockRestore();
  });

  it("picks from the library, and resolves null on cancel, dismiss or refusal", async () => {
    const { wrapper } = setup();
    const { result } = renderHook(() => useProgressPhotoCapture(), { wrapper });

    answer("Photo Library");
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
    } as never);
    await expect(result.current.capture("back")).resolves.toBeNull();
    expect(picker.launchImageLibraryAsync).toHaveBeenCalled();

    picker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [],
    } as never);
    await expect(result.current.capture("back")).resolves.toBeNull();

    answer("Cancel");
    await expect(result.current.capture("back")).resolves.toBeNull();
    answer("dismiss");
    await expect(result.current.capture("back")).resolves.toBeNull();

    // Permission refused: say why, take nothing.
    const alert = jest.spyOn(Alert, "alert");
    alert.mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.text === "Camera")?.onPress?.();
    });
    picker.requestCameraPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);
    await expect(result.current.capture("front")).resolves.toBeNull();
    expect(alert).toHaveBeenLastCalledWith(
      "Permission required",
      "We need camera access to take your progress photos.",
    );
    alert.mockImplementationOnce((_t, _m, buttons) => {
      buttons?.find((b) => b.text === "Photo Library")?.onPress?.();
    });
    picker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);
    await expect(result.current.capture("front")).resolves.toBeNull();
    expect(alert).toHaveBeenLastCalledWith(
      "Permission required",
      "We need photo-library access to choose your progress photos.",
    );
  });
});
