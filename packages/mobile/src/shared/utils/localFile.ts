/**
 * Read a file kept on the phone (a `file://` URI from the image picker or
 * `expo-image-manipulator`) as a Blob, without `expo-file-system`.
 *
 * React Native's `fetch` serves local file URIs on iOS and Android. A file
 * that has gone (e.g. the OS cleared the app's cache) rejects or answers
 * with a non-OK status; both throw here so callers can tell "the file is
 * gone" from a network failure.
 */
export async function readLocalFile(uri: string): Promise<Blob> {
  const response = await fetch(uri);
  // Local file reads report status 0 on some platforms.
  if (!response.ok && response.status !== 0) {
    throw new Error(`Photo file unreadable (${response.status})`);
  }
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("Photo file is empty");
  return blob;
}
