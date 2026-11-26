import { Alert } from "react-native";
import { chooseImageSource, pickImage } from "./imagePicker";

/**
 * PER-130: a photo question's picture, from the phone's own camera (or the
 * photo library), through the app's shared picker (`imagePicker.ts`,
 * PER-137): the Camera / Photo Library / Cancel alert, the permission
 * prompt, then the system camera or picker. Null when nothing was picked.
 */
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
  return picked.status === "picked" ? picked.asset.uri : null;
}
