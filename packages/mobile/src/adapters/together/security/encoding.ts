/** Canonical RFC 4648 encoding; React Native supplies atob/btoa (no Node Buffer). */
export function encode64(bytes: Uint8Array, url = false): string {
  const encoded = btoa(
    Array.from(bytes, (v) => String.fromCharCode(v)).join(""),
  );
  return url
    ? encoded.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
    : encoded;
}
export function decode64(
  text: string,
  url = false,
  maxLength = 60000,
): Uint8Array {
  if (typeof text !== "string" || text.length > maxLength)
    throw new Error("INVALID_ENCODING");
  const standard = url ? text.replace(/-/g, "+").replace(/_/g, "/") : text;
  const result = Uint8Array.from(atob(standard), (c) => c.charCodeAt(0));
  if (encode64(result, url) !== text) throw new Error("INVALID_ENCODING");
  return result;
}
