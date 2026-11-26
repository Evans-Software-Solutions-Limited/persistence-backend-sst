import { useCallback } from "react";
import { Alert } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import type {
  PendingProgressPhoto,
  ProgressPhotoPose,
} from "@/domain/models/progressPhotos";
import { resizeToLongEdge } from "@/shared/utils/image";
import { readLocalFile } from "@/shared/utils/localFile";
import { chooseImageSource, pickImage } from "./imagePicker";

/** Design F: every photo is a JPEG with a long edge of at most 2048 px. */
export const PROGRESS_PHOTO_MAX_EDGE = 2048;
export const PROGRESS_PHOTO_JPEG_QUALITY = 0.85;

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

/**
 * PER-137 (Y3b): take one pose through the app's photo-picking flow (the
 * same Camera / Photo Library alert and system picker as the profile
 * picture, `imagePicker.ts`), then convert it. Resolves null when the
 * athlete cancels or refuses permission.
 */
export function useProgressPhotoCapture(): {
  capture(pose: ProgressPhotoPose): Promise<PendingProgressPhoto | null>;
} {
  const capture = useCallback(async (pose: ProgressPhotoPose) => {
    const source = await chooseImageSource(`${POSE_NAME[pose]} photo`);
    if (!source) return null;
    const picked = await pickImage(source);
    if (picked.status === "denied") {
      Alert.alert(
        "Permission required",
        source === "camera"
          ? "We need camera access to take your progress photos."
          : "We need photo-library access to choose your progress photos.",
      );
      return null;
    }
    if (picked.status === "cancelled") return null;
    return prepareProgressPhoto(pose, picked.asset);
  }, []);
  return { capture };
}
