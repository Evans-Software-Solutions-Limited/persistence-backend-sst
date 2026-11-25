import { Alert } from "react-native";
import * as ImagePicker from "expo-image-picker";

/**
 * The app's photo-picking flow, shared by the profile picture
 * (`useAvatarUpload`) and progress photos (PER-137): a native alert with
 * Camera / Photo Library / Cancel, then the permission prompt and the
 * system camera or photo picker (`expo-image-picker`, in 1.2.0).
 */

export type ImageSource = "camera" | "library";

export type PickImageResult =
  | { status: "picked"; asset: ImagePicker.ImagePickerAsset }
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
export async function pickImage(
  source: ImageSource,
  opts: { allowsEditing?: boolean; aspect?: [number, number] } = {},
): Promise<PickImageResult> {
  const permission =
    source === "camera"
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return { status: "denied" };
  const options: ImagePicker.ImagePickerOptions = {
    mediaTypes: ["images"],
    quality: 1,
    ...(opts.allowsEditing ? { allowsEditing: true, aspect: opts.aspect } : {}),
  };
  const result =
    source === "camera"
      ? await ImagePicker.launchCameraAsync(options)
      : await ImagePicker.launchImageLibraryAsync(options);
  const asset = result.canceled ? null : result.assets?.[0];
  return asset?.uri ? { status: "picked", asset } : { status: "cancelled" };
}
