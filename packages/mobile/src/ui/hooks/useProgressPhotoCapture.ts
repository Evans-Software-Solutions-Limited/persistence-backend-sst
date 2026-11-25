import { useCallback } from "react";
import { Alert } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import type {
  PendingProgressPhoto,
  ProgressPhotoPose,
} from "@/domain/models/progressPhotos";
import { runNativePermissionRequest } from "@/lib/nativePermissionQueue";
import { resizeToLongEdge } from "@/shared/utils/image";
import { readLocalFile } from "@/shared/utils/localFile";

/** Design F: every photo is a JPEG with a long edge of at most 2048 px. */
export const PROGRESS_PHOTO_MAX_EDGE = 2048;
export const PROGRESS_PHOTO_JPEG_QUALITY = 0.85;

type Source = "camera" | "library";

const POSE_NAME: Record<ProgressPhotoPose, string> = {
  front: "Front",
  side: "Side",
  back: "Back",
};

/**
 * Convert a picked photo to a JPEG (long edge ≤ 2048 px, never upscaled) so
 * HEIC never reaches the server, and measure its size: the upload link pins
 * the exact byte count.
 */
export async function prepareProgressPhoto(
  pose: ProgressPhotoPose,
  asset: { uri: string; width?: number; height?: number },
  readFile: (uri: string) => Promise<Blob> = readLocalFile,
): Promise<PendingProgressPhoto> {
  const out = await ImageManipulator.manipulateAsync(
    asset.uri,
    resizeToLongEdge(
      asset.width ?? 0,
      asset.height ?? 0,
      PROGRESS_PHOTO_MAX_EDGE,
    ),
    {
      compress: PROGRESS_PHOTO_JPEG_QUALITY,
      format: ImageManipulator.SaveFormat.JPEG,
    },
  );
  const file = await readFile(out.uri);
  return {
    pose,
    uri: out.uri,
    bytes: file.size,
    width: out.width || null,
    height: out.height || null,
  };
}

function askSource(pose: ProgressPhotoPose): Promise<Source | null> {
  return new Promise((resolve) => {
    Alert.alert(
      `${POSE_NAME[pose]} photo`,
      undefined,
      [
        { text: "Camera", onPress: () => resolve("camera") },
        { text: "Photo Library", onPress: () => resolve("library") },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/**
 * PER-137 (Y3b): take one pose with the phone's own camera, or pick it from
 * the library (`expo-image-picker`, in 1.2.0), then convert it. Resolves
 * null when the athlete cancels or refuses permission.
 */
export function useProgressPhotoCapture(): {
  capture(pose: ProgressPhotoPose): Promise<PendingProgressPhoto | null>;
} {
  const capture = useCallback(async (pose: ProgressPhotoPose) => {
    const source = await askSource(pose);
    if (!source) return null;
    const permission = await runNativePermissionRequest(() =>
      source === "camera"
        ? ImagePicker.requestCameraPermissionsAsync()
        : ImagePicker.requestMediaLibraryPermissionsAsync(),
    );
    if (!permission.granted) {
      Alert.alert(
        "Permission required",
        source === "camera"
          ? "We need camera access to take your progress photos."
          : "We need photo-library access to choose your progress photos.",
      );
      return null;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 1,
    };
    const picked =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    const asset = picked.canceled ? null : picked.assets?.[0];
    if (!asset?.uri) return null;
    return prepareProgressPhoto(pose, asset);
  }, []);
  return { capture };
}
