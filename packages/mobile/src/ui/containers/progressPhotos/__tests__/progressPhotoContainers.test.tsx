import { act, fireEvent, waitFor } from "@testing-library/react-native";
import { Alert } from "react-native";
import { renderWithTheme } from "../../../../../__tests__/test-utils";
import { InMemoryApiAdapter } from "@/adapters/api/__tests__/in-memory-api.adapter";
import { InMemoryStorageAdapter } from "@/adapters/storage/__tests__/in-memory-storage.adapter";
import {
  recordUploadedPhotoSet,
  savePendingProgressPhotosCommand,
} from "@/application/commands/progressPhotos.command";
import type { AuthSession } from "@/domain/ports/auth.port";
import type {
  PendingProgressPhoto,
  ProgressPhotoPose,
  ProgressPhotoSet,
} from "@/domain/models/progressPhotos";
import { EMPTY_PROGRESS_PHOTOS } from "@/domain/services/progressPhotos.service";
import { ok } from "@/shared/errors";
import type { Adapters } from "@/shared/types";
import { AdapterProvider } from "@/ui/hooks/useAdapters";
import { AddProgressPhotosContainer } from "../AddProgressPhotosContainer";
import { ProgressPhotosGalleryContainer } from "../ProgressPhotosGalleryContainer";
import {
  ProgressPhotoViewerContainer,
  signedWeight,
} from "../ProgressPhotoViewerContainer";
import { poseFromLabel } from "../progressPhotoViews";

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockParams: { setId?: string; pose?: string } = {};
jest.mock("expo-router", () => ({
  useRouter: () => ({ push: mockPush, back: mockBack }),
  useLocalSearchParams: () => mockParams,
  useFocusEffect: (cb: () => void) => {
    const React = jest.requireActual("react") as typeof import("react");
    React.useEffect(() => cb(), [cb]);
  },
}));
const mockUploads = jest.fn(async (..._a: unknown[]) => ({
  uploaded: 0,
  retrying: 0,
  failed: 0,
}));
jest.mock("@/application/commands/sync.command", () => ({
  ...jest.requireActual("@/application/commands/sync.command"),
  processSyncQueue: jest.fn(async () => ({})),
  processProgressPhotoUploads: (...a: unknown[]) => mockUploads(...a),
}));
jest.mock("@/adapters/api", () => ({
  ...jest.requireActual("@/adapters/api"),
  getApiBaseUrl: () => "https://api.test",
}));
const mockCapture = jest.fn();
jest.mock("@/ui/hooks/useProgressPhotoCapture", () => ({
  useProgressPhotoCapture: () => ({ capture: mockCapture }),
}));

const USER = "athlete-1";

function setup() {
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
    getSession: jest.fn(async () => ok(session)),
    onAuthStateChange: jest.fn((cb: (s: AuthSession | null) => void) => {
      cb(session);
      return () => {};
    }),
    getAccessToken: jest.fn(async () => "t"),
  } as unknown as Adapters["auth"];
  const adapters: Adapters = {
    api,
    auth,
    storage,
    health: {} as Adapters["health"],
    notifications: {} as Adapters["notifications"],
    netInfo: {} as Adapters["netInfo"],
  };
  const render = (ui: React.ReactElement) =>
    renderWithTheme(
      <AdapterProvider adapters={adapters}>{ui}</AdapterProvider>,
    );
  return { api, storage, render };
}

function serverSet(
  id: string,
  takenOn: string,
  kg: number | null,
  bodyFat: number | null = null,
): ProgressPhotoSet {
  return {
    id,
    takenOn,
    source: "self",
    status: "ready",
    createdAt: `${takenOn}T09:00:00.000Z`,
    updatedAt: `${takenOn}T09:00:00.000Z`,
    photos: (["front", "side", "back"] as const).map((pose) => ({
      id: `${id}-${pose}`,
      pose,
      bytes: 10,
      width: null,
      height: null,
      url: `https://view.test/${id}/${pose}.jpg`,
      expiresAt: "2026-11-25T10:15:00.000Z",
    })),
    weight: kg == null ? null : { kg, measuredAt: `${takenOn}T07:00:00.000Z` },
    bodyFat:
      bodyFat == null
        ? null
        : { percentage: bodyFat, measuredAt: `${takenOn}T07:00:00.000Z` },
  };
}

function photo(pose: ProgressPhotoPose): PendingProgressPhoto {
  return { pose, uri: `file:///c/${pose}.jpg`, bytes: 4, width: 1, height: 1 };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete mockParams.setId;
  delete mockParams.pose;
  jest.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProgressPhotosGalleryContainer (Y3)", () => {
  it("shows server sets and sets still uploading, and routes", async () => {
    const { api, storage, render } = setup();
    api.progressPhotoSets = [
      serverSet("s1", "2026-10-25", 82.4),
      serverSet("s2", "2026-10-11", null),
    ];
    savePendingProgressPhotosCommand(storage, USER, {
      takenOn: "2026-11-25",
      photos: [photo("front"), photo("side"), photo("back")],
    });
    const s = render(<ProgressPhotosGalleryContainer />);
    await waitFor(() => expect(s.getByText("25 Oct")).toBeTruthy());
    expect(s.getByText("82.4 kg")).toBeTruthy();
    expect(s.getByText("Uploading")).toBeTruthy();
    expect(s.getByTestId("photo-gallery-pending-warning")).toBeTruthy();

    fireEvent.press(s.getByTestId("photo-set-s1-tiles-Side"));
    expect(mockPush).toHaveBeenLastCalledWith(
      "/(app)/progress-photo-viewer?setId=s1&pose=side",
    );
    fireEvent.press(s.getByTestId("photo-gallery-add"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/progress-photos-add");
    fireEvent.press(s.getByTestId("photo-gallery-back"));
    expect(mockBack).toHaveBeenCalled();
    await act(async () => {
      s.getByTestId("photo-gallery-screen");
    });
  });

  it("says when a set couldn't upload", async () => {
    const { storage, render } = setup();
    const row = savePendingProgressPhotosCommand(storage, USER, {
      takenOn: "2026-11-25",
      photos: [photo("front"), photo("side"), photo("back")],
    });
    storage.savePendingProgressPhotoSet({ ...row, failed: "file_missing" });
    const s = render(<ProgressPhotosGalleryContainer />);
    await waitFor(() => expect(s.getByText("Couldn't upload")).toBeTruthy());
  });
});

describe("AddProgressPhotosContainer (Y3b)", () => {
  it("takes three photos, saves offline-safe and starts the upload", async () => {
    const { api, storage, render } = setup();
    mockCapture.mockImplementation(async (pose: ProgressPhotoPose) =>
      photo(pose),
    );
    const s = render(<AddProgressPhotosContainer />);
    expect(s.getByText("Add 3 more to save")).toBeTruthy();
    expect(s.getByText("—")).toBeTruthy();

    for (const pose of ["front", "side", "back"] as const) {
      await act(async () => {
        fireEvent.press(s.getByTestId(`add-photo-slot-${pose}`));
      });
    }
    expect(s.getByText("Save photos")).toBeTruthy();
    await act(async () => {
      fireEvent.press(s.getByTestId("add-photos-save"));
    });
    const [row] = storage.getPendingProgressPhotoSets(USER);
    expect(row?.photos.map((p) => p.pose)).toEqual(["front", "side", "back"]);
    // The upload worker picks the set up; Save itself sends nothing.
    expect(mockUploads).not.toHaveBeenCalled();
    expect(api.progressPhotoCalls).toEqual(["list"]);
    expect(mockBack).toHaveBeenCalled();
  });

  it("shows that day's weight", async () => {
    const { storage, render } = setup();
    const today = new Date();
    const iso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
    storage.cacheBodyTrend(USER, [
      { date: iso, weightKg: 82.4, bodyFat: null },
    ]);
    const s = render(<AddProgressPhotosContainer />);
    await waitFor(() => expect(s.getByText("82.4 kg")).toBeTruthy());
  });

  it("asks coached athletes once to share photos with their coaches", async () => {
    const { storage, render } = setup();
    storage.cacheProgressPhotos(USER, {
      ...EMPTY_PROGRESS_PHOTOS,
      photoSharing: {
        needsPrompt: true,
        coaches: [{ trainerId: "t1", name: "Ana", sharing: false }],
        consentVersion: "v0",
        copy: "",
      },
    });
    // Keep the cached status (the in-memory server has no coaches).
    jest
      .spyOn(InMemoryApiAdapter.prototype, "getProgressPhotos")
      .mockResolvedValue({
        ok: false,
        error: { kind: "api", code: "unauthorized", message: "no" },
      });
    mockCapture.mockImplementation(async (pose: ProgressPhotoPose) =>
      photo(pose),
    );
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const s = render(<AddProgressPhotosContainer />);
    for (const pose of ["front", "side", "back"] as const) {
      await act(async () => {
        fireEvent.press(s.getByTestId(`add-photo-slot-${pose}`));
      });
    }
    await act(async () => {
      fireEvent.press(s.getByTestId("add-photos-save"));
    });
    expect(alert).toHaveBeenCalledWith(
      "Share progress photos with your coaches",
      expect.stringContaining("[Placeholder: Brad to write]"),
      expect.any(Array),
      { cancelable: false },
    );
    const buttons = alert.mock.calls[0]![2]!;
    act(() => buttons.find((b) => b.text === "Share")!.onPress!());
    expect(storage.getPendingMutations()[0]?.endpoint).toBe(
      "/users/me/progress-photos/sharing",
    );
    act(() => buttons.find((b) => b.text === "Not now")!.onPress!());
    expect(
      storage.getCachedProgressPhotos(USER)?.sharingPromptAnsweredFor,
    ).toEqual(["t1"]);
  });

  it("says so when a photo can't be used, and ignores a cancelled pick", async () => {
    const { storage, render } = setup();
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    mockCapture
      .mockRejectedValueOnce(new Error("bridge"))
      .mockResolvedValueOnce(null);
    const s = render(<AddProgressPhotosContainer />);
    await act(async () => {
      fireEvent.press(s.getByTestId("add-photo-slot-front"));
    });
    expect(alert).toHaveBeenCalledWith(
      "Something went wrong",
      "We couldn't use that photo. Please try again.",
    );
    await act(async () => {
      fireEvent.press(s.getByTestId("add-photo-slot-front"));
    });
    expect(s.getByText("Add 3 more to save")).toBeTruthy();
    fireEvent.press(s.getByTestId("add-photos-back"));
    expect(mockBack).toHaveBeenCalled();
    expect(storage.getPendingProgressPhotoSets(USER)).toEqual([]);
  });

  it("reports a failed save and stays", async () => {
    const { storage, render } = setup();
    mockCapture.mockImplementation(async (pose: ProgressPhotoPose) =>
      photo(pose),
    );
    jest
      .spyOn(storage, "savePendingProgressPhotoSet")
      .mockImplementation(() => {
        throw new Error("disk full");
      });
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const s = render(<AddProgressPhotosContainer />);
    for (const pose of ["front", "side", "back"] as const) {
      await act(async () => {
        fireEvent.press(s.getByTestId(`add-photo-slot-${pose}`));
      });
    }
    await act(async () => {
      fireEvent.press(s.getByTestId("add-photos-save"));
    });
    expect(alert).toHaveBeenCalledWith(
      "Something went wrong",
      "We couldn't save your photos. Please try again.",
    );
    expect(mockBack).not.toHaveBeenCalled();
  });
});

describe("ProgressPhotoViewerContainer (Y3c)", () => {
  it("shows the chosen set and pose with weight, body fat and change vs latest", async () => {
    const { api, render } = setup();
    api.progressPhotoSets = [
      serverSet("s1", "2026-10-25", 82.4, 14.8),
      serverSet("s2", "2026-10-11", 81.9, 15.1),
      serverSet("s3", "2026-09-27", null),
    ];
    mockParams.setId = "s2";
    mockParams.pose = "side";
    const s = render(<ProgressPhotoViewerContainer />);
    await waitFor(() => expect(s.getByText("Side · 11 Oct 2026")).toBeTruthy());
    expect(s.getByText("81.9 kg")).toBeTruthy();
    expect(s.getByText("15.1%")).toBeTruthy();
    expect(s.getByText("−0.5 kg")).toBeTruthy();
    expect(s.getByTestId("photo-viewer-image").props.source.cacheKey).toBe(
      "s2-side",
    );

    fireEvent.press(s.getByTestId("photo-viewer-dropdown"));
    fireEvent.press(s.getByTestId("photo-viewer-pose-Back"));
    expect(s.getByText("Back · 11 Oct 2026")).toBeTruthy();
    fireEvent.press(s.getByTestId("photo-viewer-date-s1"));
    expect(s.getByText("Back · 25 Oct 2026")).toBeTruthy();
    expect(s.getByText("Latest")).toBeTruthy();
    expect(s.queryByTestId("photo-viewer-listbox")).toBeNull();

    fireEvent.press(s.getByTestId("photo-viewer-dropdown"));
    fireEvent.press(s.getByTestId("photo-viewer-date-s3"));
    expect(s.getAllByText("—")).toHaveLength(3);

    fireEvent.press(s.getByTestId("photo-viewer-add"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/progress-photos-add");
    fireEvent.press(s.getByTestId("photo-viewer-close"));
    expect(mockBack).toHaveBeenCalled();
  });

  it("deletes a set after a confirm, then shows the next one", async () => {
    const { api, storage, render } = setup();
    api.progressPhotoSets = [
      serverSet("s1", "2026-10-25", 82.4),
      serverSet("s2", "2026-10-11", 81.9),
    ];
    mockParams.setId = "s1";
    const alert = jest.spyOn(Alert, "alert").mockImplementation(() => {});
    const s = render(<ProgressPhotoViewerContainer />);
    await waitFor(() =>
      expect(s.getByText("Front · 25 Oct 2026")).toBeTruthy(),
    );
    fireEvent.press(s.getByTestId("photo-viewer-delete"));
    expect(alert.mock.calls[0]![0]).toBe("Delete these photos?");
    expect(alert.mock.calls[0]![1]).toBe(
      "The front, side and back photos from 25 Oct will be deleted.",
    );
    const del = alert.mock.calls[0]![2]!.find((b) => b.text === "Delete")!;
    act(() => del.onPress!());
    expect(storage.getPendingMutations()[0]).toMatchObject({
      method: "DELETE",
      endpoint: "/users/me/progress-photos/s1",
    });
    await waitFor(() =>
      expect(s.getByText("Front · 11 Oct 2026")).toBeTruthy(),
    );

    // Deleting the last set closes the viewer.
    fireEvent.press(s.getByTestId("photo-viewer-delete"));
    act(() =>
      alert.mock.calls[1]![2]!.find((b) => b.text === "Delete")!.onPress!(),
    );
    expect(mockBack).toHaveBeenCalled();
  });

  it("keeps showing a phone set that uploaded while open, under its server id", async () => {
    const { api, render } = setup();
    api.progressPhotoSets = [
      serverSet("s1", "2026-10-25", 82.4),
      serverSet("s2", "2026-10-11", 81.9),
    ];
    recordUploadedPhotoSet("local-xyz", "s2");
    mockParams.setId = "local-xyz";
    const s = render(<ProgressPhotoViewerContainer />);
    await waitFor(() =>
      expect(s.getByText("Front · 11 Oct 2026")).toBeTruthy(),
    );
  });

  it("renders an empty viewer with no photos", async () => {
    const { render } = setup();
    const s = render(<ProgressPhotoViewerContainer />);
    expect(s.getByLabelText("No photos")).toBeTruthy();
    fireEvent.press(s.getByTestId("photo-viewer-dropdown"));
    fireEvent.press(s.getByTestId("photo-viewer-delete"));
    fireEvent.press(s.getByTestId("photo-viewer-add"));
    expect(mockPush).toHaveBeenLastCalledWith("/(app)/progress-photos-add");
    fireEvent.press(s.getByTestId("photo-viewer-close"));
    expect(mockBack).toHaveBeenCalled();
    await act(async () => {});
  });
});

describe("view helpers", () => {
  it("formats signed weight changes and reads pose params", () => {
    expect(signedWeight(-0.5, "kg")).toBe("−0.5 kg");
    expect(signedWeight(0.3, "kg")).toBe("+0.3 kg");
    expect(signedWeight(0.01, "kg")).toBe("0.0 kg");
    expect(signedWeight(1, "lb")).toBe("+2.2 lb");
    expect(poseFromLabel("Side")).toBe("side");
    expect(poseFromLabel("back")).toBe("back");
    expect(poseFromLabel(undefined)).toBe("front");
  });
});
