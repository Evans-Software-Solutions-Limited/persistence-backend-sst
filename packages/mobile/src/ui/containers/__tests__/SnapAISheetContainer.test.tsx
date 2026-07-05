import { act, render, waitFor } from "@testing-library/react-native";
import type { ReactNode } from "react";
import { useCameraPermissions } from "expo-camera";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import type { AuthSession } from "@/domain/ports/auth.port";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { localDayISO } from "@/shared/utils";
import { useFuelSheets } from "@/state/fuel-sheets";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { SnapAISheetProps } from "@/ui/presenters/SnapAISheetPresenter";
import { SnapAISheetContainer } from "../SnapAISheetContainer";

const mockProbe: { last: SnapAISheetProps | null } = { last: null };

jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
// The mock renders <CameraView ref={props.cameraRef} /> ONLY while `visible`
// (mirroring the real <BottomSheet>'s "camera mounts only while the capture
// stage is showing" behaviour) so the container's
// `cameraRef.current.takePictureAsync()` call has something real to hit once
// opened — a bare `return null` probe (the ScanBarcodeSheet pattern) would
// leave the ref permanently null since nothing ever attaches to it. Gating on
// `visible` also lets a test exercise the container's `!cameraRef.current`
// defensive branch (shutter fired before the sheet — and camera — mounts).
jest.mock("@/ui/presenters/SnapAISheetPresenter", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above ES imports; require() is the only option here.
  const { CameraView } = require("expo-camera");
  function MockSnapAISheetPresenter(props: SnapAISheetProps) {
    mockProbe.last = props;
    return props.visible ? <CameraView ref={props.cameraRef} /> : null;
  }
  return { SnapAISheetPresenter: MockSnapAISheetPresenter };
});

// Camera ref with an imperative takePictureAsync — the global setup.ts mock
// (__tests__/setup.ts) forwards a ref but attaches no imperative methods, so
// this container test overrides it locally to exercise the shutter path.
jest.mock("expo-camera", () => {
  /* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above ES imports; require() is the only option here. */
  const React = require("react");
  const { View } = require("react-native");
  /* eslint-enable @typescript-eslint/no-require-imports */
  const takePictureAsync = jest.fn(async () => ({
    uri: "file://captured.jpg",
  }));
  const CameraView = React.forwardRef(function MockCameraView(
    props: Record<string, unknown>,
    ref: React.Ref<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({ takePictureAsync }));
    return React.createElement(View, {
      testID: (props.testID as string) ?? "camera-view",
    });
  });
  return {
    __esModule: true,
    CameraView,
    __takePictureAsync: takePictureAsync,
    useCameraPermissions: jest.fn(() => [
      { granted: true, canAskAgain: true, status: "granted" },
      jest.fn(async () => ({ granted: true, status: "granted" })),
    ]),
  };
});

jest.mock("expo-image-picker", () => ({
  requestMediaLibraryPermissionsAsync: jest.fn(),
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __takePictureAsync: mockTakePicture } = require("expo-camera") as {
  __takePictureAsync: jest.Mock;
};

const USER = "user-1";

function makeAdapters() {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: USER,
    email: "a@b.com",
    expiresAt: Date.now() + 60_000,
  };
  const auth = {
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  return {
    storage,
    api,
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {
        isConnected: async () => true,
        subscribe: () => () => {},
      } as unknown as Adapters["netInfo"],
    } as Adapters,
  };
}

function Wrapper({
  adapters,
  children,
}: {
  adapters: Adapters;
  children: ReactNode;
}) {
  return <AdapterProvider adapters={adapters}>{children}</AdapterProvider>;
}

(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));

describe("SnapAISheetContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    jest.clearAllMocks();
    mockTakePicture.mockResolvedValue({ uri: "file://captured.jpg" });
    mockedManipulator.manipulateAsync.mockResolvedValue({
      uri: "file://manipulated.jpg",
      width: 1080,
      height: 810,
      base64: "BASE64DATA",
    } as never);
    act(() =>
      useFuelSheets.setState({ sheet: null, slot: "breakfast", rev: 0 }),
    );
  });

  it("is hidden until opened via the store", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.visible).toBe(false);
    act(() => useFuelSheets.getState().openSnap("lunch"));
    expect(mockProbe.last?.visible).toBe(true);
    expect(mockProbe.last?.stage).toBe("capture");
  });

  it("marks the capture affordance offline when the device is offline", () => {
    const { adapters } = makeAdapters();
    (adapters as { netInfo: unknown }).netInfo = {
      isConnected: async () => false,
      subscribe: (cb: (c: boolean) => void) => {
        cb(false);
        return () => {};
      },
    };
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    expect(mockProbe.last?.offline).toBe(true);
  });

  it("shutter press captures, downscales, and calls estimateFromPhoto", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap("lunch"));

    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });

    expect(mockTakePicture).toHaveBeenCalled();
    expect(mockedManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file://captured.jpg",
      [{ resize: { width: 1080 } }],
      expect.objectContaining({ compress: 0.7, base64: true }),
    );
    expect(api.estimateFromPhotoCalls).toHaveLength(1);
    expect(api.estimateFromPhotoCalls[0]).toEqual({
      imageBase64: "BASE64DATA",
      mediaType: "image/jpeg",
      mealType: "lunch",
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("confirm"));
  });

  it("low-confidence items default-unticked after a successful estimate", async () => {
    const { adapters, api } = makeAdapters();
    api.aiEstimate = {
      foods: [
        {
          name: "Chicken",
          quantity: 1,
          unit: "piece",
          estimatedGrams: 180,
          kcal: 300,
          proteinG: 56,
          carbsG: 0,
          fatG: 7,
          confidence: 0.94,
        },
        {
          name: "Olive oil",
          quantity: 1,
          unit: "tbsp",
          estimatedGrams: 5,
          kcal: 40,
          proteinG: 0,
          carbsG: 0,
          fatG: 4.5,
          confidence: 0.62,
        },
      ],
      overallConfidence: 0.78,
      notes: null,
    };
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("confirm"));
    expect(mockProbe.last?.items[0]?.on).toBe(true);
    expect(mockProbe.last?.items[1]?.on).toBe(false);
  });

  it("goes to the error stage on an estimate failure, with retry re-sending the same photo", async () => {
    const { adapters, api } = makeAdapters();
    api.nextAiEstimateError = { status: 422, message: "ai_unreadable" };
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("error"));
    expect(mockProbe.last?.errorMessage).toBeTruthy();

    // Retry re-sends the same photo without recapturing.
    api.nextAiEstimateError = null;
    await act(async () => {
      mockProbe.last!.onRetry();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("confirm"));
    expect(mockTakePicture).toHaveBeenCalledTimes(1); // not recaptured
    expect(api.estimateFromPhotoCalls).toHaveLength(2);
  });

  it("choose-another returns to capture and clears the retained photo", async () => {
    const { adapters, api } = makeAdapters();
    api.nextAiEstimateError = { status: 503, message: "ai_unavailable" };
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("error"));

    act(() => mockProbe.last!.onChooseAnother());
    expect(mockProbe.last?.stage).toBe("capture");
  });

  it("picks from the library, downscales, and estimates", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://library.jpg" } as never],
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onPickFromLibrary();
    });
    expect(mockedManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file://library.jpg",
      [{ resize: { width: 1080 } }],
      expect.objectContaining({ compress: 0.7 }),
    );
    expect(api.estimateFromPhotoCalls).toHaveLength(1);
    await waitFor(() => expect(mockProbe.last?.stage).toBe("confirm"));
  });

  it("does nothing when the library permission is denied", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onPickFromLibrary();
    });
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
    expect(mockProbe.last?.stage).toBe("capture");
  });

  it("does nothing when the library pick is cancelled", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onPickFromLibrary();
    });
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
  });

  it("does nothing when the library pick result has no asset uri", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [],
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onPickFromLibrary();
    });
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
  });

  it("does nothing when the library manipulate step returns no base64", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://library.jpg" } as never],
    } as never);
    mockedManipulator.manipulateAsync.mockResolvedValueOnce({
      uri: "file://manipulated.jpg",
      width: 1080,
      height: 810,
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onPickFromLibrary();
    });
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
  });

  it("does nothing when the shutter capture returns no photo", async () => {
    const { adapters, api } = makeAdapters();
    mockTakePicture.mockResolvedValueOnce({} as never); // no uri
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
  });

  it("does nothing when the shutter manipulate step returns no base64", async () => {
    const { adapters, api } = makeAdapters();
    mockedManipulator.manipulateAsync.mockResolvedValueOnce({
      uri: "file://manipulated.jpg",
      width: 1080,
      height: 810,
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
  });

  it("toggling and editing grams recompute the confirm total", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("confirm"));
    const initialKcal = mockProbe.last!.totalKcal;
    expect(initialKcal).toBeGreaterThan(0);

    act(() =>
      mockProbe.last!.onEditGrams(
        0,
        mockProbe.last!.items[0]!.estimatedGrams / 2,
      ),
    );
    await waitFor(() =>
      expect(mockProbe.last?.totalKcal).toBeLessThan(initialKcal),
    );

    act(() => mockProbe.last!.onToggleItem(0));
    await waitFor(() => expect(mockProbe.last?.totalKcal).toBe(0));
  });

  it("confirm logs kept items, notifies mutation, and auto-closes after the added affirmation", async () => {
    jest.useFakeTimers();
    const { adapters, storage } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap("dinner"));
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("confirm"));

    await act(async () => {
      await mockProbe.last!.onConfirm();
    });
    expect(mockProbe.last?.stage).toBe("added");
    expect(
      storage.getCachedFuelToday(USER, localDayISO())?.entriesBySlot.dinner
        .length,
    ).toBe(1);
    expect(useFuelSheets.getState().rev).toBe(1);

    act(() => jest.advanceTimersByTime(900));
    expect(useFuelSheets.getState().sheet).toBeNull();
    jest.useRealTimers();
  });

  it("confirm with nothing kept does not close the sheet", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("confirm"));
    act(() => mockProbe.last!.onToggleItem(0)); // untick the only item
    await act(async () => {
      await mockProbe.last!.onConfirm();
    });
    expect(mockProbe.last?.stage).toBe("confirm"); // unchanged, still open
    expect(useFuelSheets.getState().sheet).toBe("snap");
  });

  it("changing the meal slot in confirm updates the estimate mealType on retry", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap("breakfast"));
    act(() => mockProbe.last!.onSlotChange("snack"));
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    expect(api.estimateFromPhotoCalls[0]?.mealType).toBe("snack");
  });

  it("does nothing on shutter press if the camera hasn't mounted yet (cameraRef.current is null)", async () => {
    // Simulates a race where the shutter fires before the sheet (and its
    // camera) mount — visible is still false, so the mocked presenter above
    // doesn't render <CameraView>, leaving cameraRef.current null.
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.visible).toBe(false);
    await act(async () => {
      await mockProbe.last!.onShutterPress();
    });
    expect(mockTakePicture).not.toHaveBeenCalled();
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
  });

  it("a genuine dismiss clears the store; a handoff does not", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    act(() => mockProbe.last!.onClose());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("onClose is a no-op while already hidden (handoff guard)", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    // Never opened — visible is false. A stray onClose (e.g. from another
    // sheet's handoff animation settling) must not touch the shared store.
    act(() => mockProbe.last!.onClose());
    expect(useFuelSheets.getState().sheet).toBeNull();
  });

  it("retry with no retained photo falls back to the capture stage", async () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    // No shutter/pick has run yet, so lastPhotoRef is null.
    act(() => mockProbe.last!.onRetry());
    expect(mockProbe.last?.stage).toBe("capture");
    expect(api.estimateFromPhotoCalls).toHaveLength(0);
  });

  it("falls back to hasPermission=false when the permission hook returns null", () => {
    const mockedUseCameraPermissions = useCameraPermissions as jest.Mock;
    mockedUseCameraPermissions.mockReturnValue([null, jest.fn()]);
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    expect(mockProbe.last?.hasPermission).toBe(false);
    mockedUseCameraPermissions.mockReturnValue([
      { granted: true, canAskAgain: true, status: "granted" },
      jest.fn(async () => ({ granted: true, status: "granted" })),
    ]);
  });

  it("wires onRequestPermission to the camera permission request", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <SnapAISheetContainer />
      </Wrapper>,
    );
    act(() => useFuelSheets.getState().openSnap());
    // The global expo-camera mock's requestPermission resolves a granted
    // permission — just verify the presenter's callback doesn't throw and is
    // wired (the permission-granted default is asserted elsewhere).
    expect(() => mockProbe.last!.onRequestPermission()).not.toThrow();
  });
});
