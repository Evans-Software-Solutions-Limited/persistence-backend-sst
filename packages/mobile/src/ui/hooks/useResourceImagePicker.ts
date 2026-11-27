import { useCallback } from "react";
import { Alert } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import { resizeToLongEdge } from "@/shared/utils/image";
import { chooseImageSource, pickImage } from "./imagePicker";

/** Library images: a JPEG with a long edge of at most 2048 px. */
export const RESOURCE_IMAGE_MAX_EDGE = 2048;
export const RESOURCE_IMAGE_JPEG_QUALITY = 0.85;

export type PickedResourceImage = {
  /** The converted JPEG on the phone. */
  uri: string;
  contentType: "image/jpeg";
  /** The picker's file name when it gives one (used for the name). */
  fileName: string | null;
};

/**
 * PER-143 "Upload" on iPhone: the app's own photo-picking flow (the Camera /
 * Photo Library alert and system picker, `imagePicker.ts`, in 1.2.0 — Brad,
 * 26 Nov: same picker as other image uploads), then a JPEG conversion so
 * HEIC never reaches the server (it takes JPEG, PNG and PDF). No document
 * picker: that would be a native change. Resolves null when cancelled.
 */
export function useResourceImagePicker(): {
  pick(): Promise<PickedResourceImage | null>;
} {
  const pick = useCallback(async () => {
    const source = await chooseImageSource("Upload a photo");
    if (!source) return null;
    const picked = await pickImage(source);
    if (picked.status === "denied") {
      Alert.alert(
        "Permission required",
        source === "camera"
          ? "We need camera access to take a photo to share."
          : "We need photo-library access to choose a photo to share.",
      );
      return null;
    }
    if (picked.status === "cancelled") return null;
    const { asset } = picked;
    const out = await ImageManipulator.manipulateAsync(
      asset.uri,
      resizeToLongEdge(
        asset.width ?? 0,
        asset.height ?? 0,
        RESOURCE_IMAGE_MAX_EDGE,
      ),
      {
        compress: RESOURCE_IMAGE_JPEG_QUALITY,
        format: ImageManipulator.SaveFormat.JPEG,
      },
    );
    return {
      uri: out.uri,
      contentType: "image/jpeg" as const,
      fileName: asset.fileName ?? null,
    };
  }, []);
  return { pick };
}
