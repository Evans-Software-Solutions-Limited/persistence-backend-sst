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
import { useRecipeDraft } from "@/state/recipe-draft";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import type { RecipeSnapPresenterProps } from "@/ui/presenters/RecipeSnapPresenter";
import { RecipeSnapContainer } from "../RecipeSnapContainer";

const mockProbe: { last: RecipeSnapPresenterProps | null } = { last: null };

jest.mock("@/ui/presenters/RecipeSnapPresenter", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports -- jest.mock factories are hoisted above ES imports; require() is the only option here.
  const { CameraView } = require("expo-camera");
  function MockRecipeSnapPresenter(props: RecipeSnapPresenterProps) {
    mockProbe.last = props;
    // Mirrors the real presenter: the camera only mounts in the capture
    // stage AND once permission is granted — lets a test exercise the
    // container's `!cameraRef.current` defensive branch by denying
    // permission (see "does nothing on shutter press without permission").
    return props.stage === "capture" && props.hasPermission ? (
      <CameraView ref={props.cameraRef} />
    ) : null;
  }
  return { RecipeSnapPresenter: MockRecipeSnapPresenter };
});

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
const mockedUseCameraPermissions = useCameraPermissions as jest.Mock;

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { __takePictureAsync: mockTakePicture } = require("expo-camera") as {
  __takePictureAsync: jest.Mock;
};

const mockRouterBack = jest.fn();
const mockRouterReplace = jest.fn();
jest.mock("expo-router", () => ({
  __esModule: true,
  router: {
    back: (...args: unknown[]) => mockRouterBack(...args),
    replace: (...args: unknown[]) => mockRouterReplace(...args),
  },
}));

const mockAiGate: { allowed: boolean; onUpgrade: jest.Mock } = {
  allowed: true,
  onUpgrade: jest.fn(),
};
jest.mock("@/ui/hooks/useNutritionAiGate", () => ({
  useNutritionAiGate: () => ({
    allowed: mockAiGate.allowed,
    reason: "tier",
    gateProps: { onUpgrade: mockAiGate.onUpgrade },
  }),
}));

(globalThis as Record<string, unknown>).fetch = jest.fn(async () => ({
  ok: true,
  status: 200,
  headers: { get: () => null },
  json: async () => ({ data: {} }),
}));

function makeAdapters(online = true): {
  adapters: Adapters;
  api: InMemoryApiAdapter;
} {
  const api = new InMemoryApiAdapter();
  const storage = new InMemoryStorageAdapter();
  const session: AuthSession = {
    accessToken: "t",
    refreshToken: "r",
    userId: "user-1",
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
    api,
    adapters: {
      api,
      auth,
      storage,
      health: {} as Adapters["health"],
      notifications: {} as Adapters["notifications"],
      payments: {} as Adapters["payments"],
      netInfo: {
        isConnected: async () => online,
        subscribe: (cb: (c: boolean) => void) => {
          cb(online);
          return () => {};
        },
      } as unknown as Adapters["netInfo"],
    },
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

describe("RecipeSnapContainer", () => {
  beforeEach(() => {
    mockProbe.last = null;
    jest.clearAllMocks();
    mockAiGate.allowed = true;
    mockTakePicture.mockResolvedValue({ uri: "file://captured.jpg" });
    mockedManipulator.manipulateAsync.mockResolvedValue({
      uri: "file://manipulated.jpg",
      width: 1080,
      height: 1440,
      base64: "BASE64DATA",
    } as never);
    useRecipeDraft.getState().clear();
  });

  it("starts in the capture stage", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.stage).toBe("capture");
    expect(mockProbe.last?.offline).toBe(false);
  });

  it("marks offline when the device has no connection", () => {
    const { adapters } = makeAdapters(false);
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.offline).toBe(true);
  });

  it("shutter press captures, downscales, and calls extractRecipeFromPhoto, then seeds the draft + navigates", async () => {
    const { adapters, api } = makeAdapters();
    api.extractedRecipe = {
      title: "Shakshuka",
      servings: 4,
      timeMinutes: 30,
      ingredients: [{ name: "Eggs", quantity: 4, unit: null }],
      steps: ["Cook it"],
      confidence: 0.9,
      notes: null,
    };
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );

    await act(async () => {
      mockProbe.last!.onShutterPress();
    });

    expect(mockTakePicture).toHaveBeenCalled();
    expect(mockedManipulator.manipulateAsync).toHaveBeenCalledWith(
      "file://captured.jpg",
      [{ resize: { width: 1080 } }],
      expect.objectContaining({ compress: 0.7, base64: true }),
    );
    expect(api.extractRecipeFromPhotoCalls).toEqual([
      { imageBase64: "BASE64DATA", mediaType: "image/jpeg" },
    ]);
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/(app)/fuel/recipe-create",
      ),
    );
    expect(useRecipeDraft.getState().seed).toEqual({
      title: "Shakshuka",
      servings: 4,
      instructions: "1. Cook it",
      ingredients: [{ name: "Eggs", quantity: 4, unit: null }],
      source: "snap",
    });
  });

  it("does nothing on shutter press when the camera hasn't mounted (no permission yet)", async () => {
    mockedUseCameraPermissions.mockReturnValueOnce([
      { granted: false, canAskAgain: true, status: "denied" },
      jest.fn(),
    ]);
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.hasPermission).toBe(false);
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    expect(mockTakePicture).not.toHaveBeenCalled();
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("hasPermission is false while the permission probe hasn't resolved yet", () => {
    mockedUseCameraPermissions.mockReturnValueOnce([null, jest.fn()]);
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    expect(mockProbe.last?.hasPermission).toBe(false);
  });

  it("onShutterPress does nothing when takePictureAsync returns no uri", async () => {
    mockTakePicture.mockResolvedValueOnce({ uri: undefined } as never);
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    expect(mockedManipulator.manipulateAsync).not.toHaveBeenCalled();
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("onShutterPress does nothing when the downscale yields no base64", async () => {
    mockedManipulator.manipulateAsync.mockResolvedValueOnce({
      uri: "file://manipulated.jpg",
      width: 1080,
      height: 1440,
      base64: undefined,
    } as never);
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("shows the unreadable message on 422", async () => {
    const { adapters, api } = makeAdapters();
    api.nextRecipeAiError = { status: 422, message: "ai_unreadable" };
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("error"));
    expect(mockProbe.last?.errorMessage).toMatch(/Couldn't read a recipe/);
  });

  it("shows the daily-limit message on 429", async () => {
    const { adapters, api } = makeAdapters();
    api.nextRecipeAiError = { status: 429, message: "ai_daily_limit" };
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("error"));
    expect(mockProbe.last?.errorMessage).toMatch(/Daily AI limit/);
  });

  it("does not fire the AI call when the gate denies (defensive re-guard)", async () => {
    mockAiGate.allowed = false;
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
    expect(mockProbe.last?.stage).toBe("capture");
  });

  it("does not fire the AI call when offline (defensive re-guard)", async () => {
    const { adapters, api } = makeAdapters(false);
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("onRetry re-sends the last photo", async () => {
    const { adapters, api } = makeAdapters();
    api.nextRecipeAiError = { status: 503, message: "ai_unavailable" };
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("error"));

    api.nextRecipeAiError = null;
    api.extractedRecipe = {
      title: "Retry recipe",
      servings: null,
      timeMinutes: null,
      ingredients: [],
      steps: [],
      confidence: 0.5,
      notes: null,
    };
    await act(async () => {
      mockProbe.last!.onRetry();
    });
    await waitFor(() =>
      expect(mockRouterReplace).toHaveBeenCalledWith(
        "/(app)/fuel/recipe-create",
      ),
    );
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(2);
  });

  it("onRetry with no prior capture falls back to the capture stage (no AI call)", () => {
    const { adapters, api } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onRetry());
    expect(mockProbe.last?.stage).toBe("capture");
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("onRequestPermission does not throw", async () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onRequestPermission();
    });
    expect(mockProbe.last).not.toBeNull();
  });

  it("onChooseAnother resets to the capture stage", async () => {
    const { adapters, api } = makeAdapters();
    api.nextRecipeAiError = { status: 422, message: "ai_unreadable" };
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onShutterPress();
    });
    await waitFor(() => expect(mockProbe.last?.stage).toBe("error"));
    act(() => mockProbe.last!.onChooseAnother());
    expect(mockProbe.last?.stage).toBe("capture");
  });

  it("onPickFromLibrary captures from the library when picker succeeds", async () => {
    const { adapters, api } = makeAdapters();
    api.extractedRecipe = {
      title: "Library recipe",
      servings: 2,
      timeMinutes: null,
      ingredients: [],
      steps: [],
      confidence: 0.8,
      notes: null,
    };
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://library.jpg" }],
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onPickFromLibrary();
    });
    await waitFor(() =>
      expect(api.extractRecipeFromPhotoCalls).toHaveLength(1),
    );
  });

  it("onPickFromLibrary does nothing when library permission is denied", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: false,
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onPickFromLibrary();
    });
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
    expect(mockedPicker.launchImageLibraryAsync).not.toHaveBeenCalled();
  });

  it("onPickFromLibrary does nothing when the picker is cancelled", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: true,
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onPickFromLibrary();
    });
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("onPickFromLibrary does nothing when the picked asset has no uri", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: undefined }],
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onPickFromLibrary();
    });
    expect(mockedManipulator.manipulateAsync).not.toHaveBeenCalled();
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("onPickFromLibrary does nothing when the downscale yields no base64", async () => {
    const { adapters, api } = makeAdapters();
    mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
      granted: true,
    } as never);
    mockedPicker.launchImageLibraryAsync.mockResolvedValue({
      canceled: false,
      assets: [{ uri: "file://library.jpg" }],
    } as never);
    mockedManipulator.manipulateAsync.mockResolvedValueOnce({
      uri: "file://manipulated.jpg",
      width: 1080,
      height: 1440,
      base64: undefined,
    } as never);
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    await act(async () => {
      mockProbe.last!.onPickFromLibrary();
    });
    expect(api.extractRecipeFromPhotoCalls).toHaveLength(0);
  });

  it("Back routes back", () => {
    const { adapters } = makeAdapters();
    render(
      <Wrapper adapters={adapters}>
        <RecipeSnapContainer />
      </Wrapper>,
    );
    act(() => mockProbe.last!.onBack());
    expect(mockRouterBack).toHaveBeenCalledTimes(1);
  });
});
