import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import {
  chooseImageSource,
  pickFormPhoto,
  pickImage,
} from "../formPhotoPicker";

jest.mock("expo-image-picker", () => ({
  requestCameraPermissionsAsync: jest.fn(),
  requestMediaLibraryPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
  launchImageLibraryAsync: jest.fn(),
}));

// The shared queue runs one native permission prompt at a time; here, now.
jest.mock("@/lib/nativePermissionQueue", () => ({
  runNativePermissionRequest: <T>(fn: () => Promise<T>) => fn(),
}));

const picker = ImagePicker as jest.Mocked<typeof ImagePicker>;
type Button = { text: string; onPress?: () => void };
type AlertOpts = { onDismiss?: () => void };

/** Answer the next Alert by tapping the button with this text. */
function tap(text: string | "dismiss") {
  jest.spyOn(Alert, "alert").mockImplementationOnce((_t, _m, buttons, opts) => {
    if (text === "dismiss")
      return (opts as AlertOpts | undefined)?.onDismiss?.();
    (buttons as Button[]).find((b) => b.text === text)?.onPress?.();
  });
}

const granted = { granted: true } as never;
const denied = { granted: false } as never;

beforeEach(() => {
  jest.restoreAllMocks();
  picker.requestCameraPermissionsAsync.mockResolvedValue(granted);
  picker.requestMediaLibraryPermissionsAsync.mockResolvedValue(granted);
  picker.launchCameraAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://camera.jpg" }],
  } as never);
  picker.launchImageLibraryAsync.mockResolvedValue({
    canceled: false,
    assets: [{ uri: "file://library.jpg" }],
  } as never);
});

describe("formPhotoPicker (the phone's own camera, PER-130)", () => {
  it("the source alert: Camera, Photo Library, Cancel, dismiss", async () => {
    tap("Camera");
    await expect(chooseImageSource("Add a photo")).resolves.toBe("camera");
    tap("Photo Library");
    await expect(chooseImageSource("Add a photo")).resolves.toBe("library");
    tap("Cancel");
    await expect(chooseImageSource("Add a photo")).resolves.toBeNull();
    tap("dismiss");
    await expect(chooseImageSource("Add a photo")).resolves.toBeNull();
  });

  it("asks permission, then opens the camera or the library", async () => {
    await expect(pickImage("camera")).resolves.toEqual({
      status: "picked",
      uri: "file://camera.jpg",
    });
    await expect(pickImage("library")).resolves.toEqual({
      status: "picked",
      uri: "file://library.jpg",
    });
    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: true } as never);
    await expect(pickImage("camera")).resolves.toEqual({ status: "cancelled" });
    picker.requestCameraPermissionsAsync.mockResolvedValueOnce(denied);
    await expect(pickImage("camera")).resolves.toEqual({ status: "denied" });
  });

  it("the whole flow: a photo, nothing, or the permission message", async () => {
    tap("Camera");
    await expect(pickFormPhoto()).resolves.toBe("file://camera.jpg");

    tap("Cancel");
    await expect(pickFormPhoto()).resolves.toBeNull();

    picker.requestMediaLibraryPermissionsAsync.mockResolvedValueOnce(denied);
    tap("Photo Library");
    const shown = jest.spyOn(Alert, "alert");
    await expect(pickFormPhoto()).resolves.toBeNull();
    expect(shown).toHaveBeenLastCalledWith(
      "Permission required",
      "We need photo-library access to choose this photo.",
    );

    picker.requestCameraPermissionsAsync.mockResolvedValueOnce(denied);
    tap("Camera");
    await expect(pickFormPhoto()).resolves.toBeNull();
    expect(shown).toHaveBeenLastCalledWith(
      "Permission required",
      "We need camera access to take this photo.",
    );

    picker.launchCameraAsync.mockResolvedValueOnce({ canceled: true } as never);
    tap("Camera");
    await expect(pickFormPhoto()).resolves.toBeNull();
  });
});
