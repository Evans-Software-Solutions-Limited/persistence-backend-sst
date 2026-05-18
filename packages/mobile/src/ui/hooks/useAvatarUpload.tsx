import { useCallback, useRef, useState } from "react";
import { Alert } from "react-native";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { useAdapters } from "./useAdapters";
import { useAuth } from "./useAuth";

/**
 * M6 PR-3: avatar selection + upload + remove flow.
 *
 * Mirrors the legacy `persistence-mobile` Profile tab:
 *   handleSelectProfilePicture → Alert.alert with [Camera, Library, Remove?, Cancel]
 *   handleImagePicker(source)   → permission → picker (1:1, allowsEditing) →
 *                                 resize to 512×512 JPEG q80 → upload
 *   handleRemoveProfilePicture  → DELETE /profile/avatar
 *
 * Resize is client-side (matches legacy). The backend validates content-type
 * and the 5MB cap but does not re-encode — keeps the Lambda free of sharp /
 * native image libraries.
 *
 * Returns a `cacheKey` that increments on every successful upload/remove.
 * The container threads this into the `<Image>` `key` + URL query string
 * so RN's in-memory image cache and any CDN layer are bypassed on the
 * next paint — without this, the URL is stable per-user so the old image
 * sticks until the user kills the app.
 */

const TARGET_DIMENSION = 512;
const JPEG_QUALITY = 0.8;

export type AvatarUploadState = {
  /** Increment-on-success counter for cache-busting `<Image>` key/uri. */
  cacheKey: number;
  /** True while any action (permission, picker, resize, upload) is in flight. */
  isWorking: boolean;
  /** Open the 3-or-4-option Alert (Camera / Library / Remove? / Cancel). */
  showAvatarSheet: () => void;
};

type PickerSource = "camera" | "library";

export function useAvatarUpload(
  currentAvatarUrl: string | null,
): AvatarUploadState {
  const { api, storage } = useAdapters();
  const { session } = useAuth();
  const userId = session?.userId ?? null;

  const [cacheKey, setCacheKey] = useState(0);
  const [isWorking, setIsWorking] = useState(false);
  // Synchronous re-entrancy guard — matches the sign-out ref in
  // ProfileContainer. Two taps in the same event-loop turn would both
  // pass a state-only guard because React batches setIsWorking(true).
  const isWorkingRef = useRef(false);

  const invalidateAndBump = useCallback(() => {
    if (userId) storage.invalidateProfilePage(userId);
    setCacheKey((k) => k + 1);
  }, [storage, userId]);

  const uploadFromUri = useCallback(
    async (uri: string) => {
      // Resize to a 512px square JPEG. expo-image-manipulator runs on the
      // native side so we don't pull bytes into JS just to throw them out.
      const resized = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: TARGET_DIMENSION, height: TARGET_DIMENSION } }],
        {
          compress: JPEG_QUALITY,
          format: ImageManipulator.SaveFormat.JPEG,
        },
      );

      const result = await api.uploadAvatar({
        uri: resized.uri,
        mimeType: "image/jpeg",
        name: "avatar.jpg",
      });

      if (!result.ok) {
        Alert.alert(
          "Upload failed",
          result.error.message ||
            "Couldn't upload your photo. Check your connection and try again.",
        );
        return;
      }
      invalidateAndBump();
    },
    [api, invalidateAndBump],
  );

  const handlePickerSource = useCallback(
    async (source: PickerSource) => {
      const permission =
        source === "camera"
          ? await ImagePicker.requestCameraPermissionsAsync()
          : await ImagePicker.requestMediaLibraryPermissionsAsync();

      if (!permission.granted) {
        Alert.alert(
          "Permission required",
          source === "camera"
            ? "We need camera access to take a profile picture."
            : "We need photo-library access to choose a profile picture.",
        );
        return;
      }

      const pickerResult =
        source === "camera"
          ? await ImagePicker.launchCameraAsync({
              mediaTypes: ["images"],
              allowsEditing: true,
              aspect: [1, 1],
              quality: 1,
            })
          : await ImagePicker.launchImageLibraryAsync({
              mediaTypes: ["images"],
              allowsEditing: true,
              aspect: [1, 1],
              quality: 1,
            });

      if (pickerResult.canceled) return;
      const asset = pickerResult.assets?.[0];
      if (!asset?.uri) return;

      await uploadFromUri(asset.uri);
    },
    [uploadFromUri],
  );

  const handleRemove = useCallback(async () => {
    const result = await api.deleteAvatar();
    if (!result.ok) {
      Alert.alert(
        "Remove failed",
        result.error.message ||
          "Couldn't remove your photo. Check your connection and try again.",
      );
      return;
    }
    invalidateAndBump();
  }, [api, invalidateAndBump]);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (isWorkingRef.current) return;
    isWorkingRef.current = true;
    setIsWorking(true);
    try {
      await action();
    } finally {
      setIsWorking(false);
      isWorkingRef.current = false;
    }
  }, []);

  const showAvatarSheet = useCallback(() => {
    if (isWorkingRef.current) return;

    const buttons: Parameters<typeof Alert.alert>[2] = [
      {
        text: "Camera",
        onPress: () => {
          void run(() => handlePickerSource("camera"));
        },
      },
      {
        text: "Photo Library",
        onPress: () => {
          void run(() => handlePickerSource("library"));
        },
      },
    ];

    if (currentAvatarUrl) {
      buttons.push({
        text: "Remove Profile Picture",
        style: "destructive",
        onPress: () => {
          void run(handleRemove);
        },
      });
    }

    buttons.push({ text: "Cancel", style: "cancel" });

    Alert.alert("Profile Picture", "Choose an option", buttons);
  }, [currentAvatarUrl, handlePickerSource, handleRemove, run]);

  return { cacheKey, isWorking, showAvatarSheet };
}
