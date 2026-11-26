import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { runNativePermissionRequest } from "@/lib/nativePermissionQueue";

/**
 * PER-130: a photo question's picture, from the phone's own camera (or the
 * photo library), with `expo-image-picker` (in 1.2.0, no native change).
 *
 * Same flow and API as the shared picker PER-137 adds in
 * `src/ui/hooks/imagePicker.ts` (#567, not on main when this was written):
 * the Camera / Photo Library / Cancel alert, then the permission prompt
 * through the shared native-permission queue, then the system camera or
 * picker. Once #567 merges, this file can re-export that one.
 */

export type ImageSource = "camera" | "library";

export type PickImageResult =
  | { status: "picked"; uri: string }
  | { status: "denied" }
  | { status: "cancelled" };

/** The Camera / Photo Library / Cancel alert. Resolves null on cancel. */
export function chooseImageSource(
  title: string,
  message = "Choose an option",
): Promise<ImageSource | null> {
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: "Camera", onPress: () => resolve("camera") },
        { text: "Photo Library", onPress: () => resolve("library") },
        { text: "Cancel", style: "cancel", onPress: () => resolve(null) },
      ],
      { cancelable: true, onDismiss: () => resolve(null) },
    );
  });
}

/** Ask for permission, then open the system camera or photo picker. */
export async function pickImage(source: ImageSource): Promise<PickImageResult> {
  const permission = await runNativePermissionRequest(() =>
    source === "camera"
      ? ImagePicker.requestCameraPermissionsAsync()
      : ImagePicker.requestMediaLibraryPermissionsAsync(),
  );
  if (!permission.granted) return { status: "denied" };
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const uri = result.canceled ? null : result.assets?.[0]?.uri;
  return uri ? { status: "picked", uri } : { status: "cancelled" };
}

/** The whole flow for one photo question. Null when nothing was picked. */
export async function pickFormPhoto(): Promise<string | null> {
  const source = await chooseImageSource("Add a photo");
  if (!source) return null;
  const picked = await pickImage(source);
  if (picked.status === "denied") {
    Alert.alert(
      "Permission required",
      source === "camera"
        ? "We need camera access to take this photo."
        : "We need photo-library access to choose this photo.",
    );
    return null;
  }
  return picked.status === "picked" ? picked.uri : null;
}
