/**
 * Shared image-payload validation for AI photo endpoints (nutrition
 * estimate + Recipes AI extract-recipe). Extracted from
 * `nutrition/ai/estimate/nutritionAiEstimateHandler.ts` (M9.5) so
 * `nutritionAiExtractRecipeHandler.ts` doesn't duplicate the
 * decode/size/magic-byte checks. Behaviour is unchanged from the
 * original inline implementation.
 */

// 5 MB — the client downscales + compresses to ~150-530 KB before
// sending (design.md § Revised 2026-07-03 "Image transport"), so this
// cap is a generous abuse guard, not the expected steady-state size.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

// Elysia-schema ceiling on the base64 string itself: rejects grossly
// oversized bodies during validation, BEFORE the handler body runs and
// before any decode/stringify allocation. 5MB decoded ≈ 6.67MB encoded;
// 7MB leaves headroom so legitimate near-cap uploads still reach the
// precise MAX_IMAGE_BYTES checks below (which own the 413 semantics).
// Beyond this ceiling the client gets Elysia's standard 422 validation
// error — acceptable: the app never produces such payloads (client
// downscales to ~150-530 KB).
export const MAX_IMAGE_BASE64_LENGTH = 7 * 1024 * 1024;

const JPEG_MAGIC = [0xff, 0xd8, 0xff];
// Full 8-byte PNG signature (89 50 4E 47 0D 0A 1A 0A).
const PNG_MAGIC = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Decode base64 → Buffer, or `null` on malformed input. Malformed base64
 * is treated the same as a magic-byte mismatch (400 invalid_image_data)
 * rather than a 500 — it's untrusted client input.
 */
export function decodeBase64(imageBase64: string): Buffer | null {
  try {
    const buf = Buffer.from(imageBase64, "base64");
    // Buffer.from with invalid base64 doesn't always throw — it silently
    // drops invalid characters, which can produce a suspiciously short
    // buffer for well-formed-looking input. An empty result is never a
    // valid image.
    if (buf.length === 0) return null;
    return buf;
  } catch {
    return null;
  }
}

function hasMagicBytes(buf: Buffer, magic: number[]): boolean {
  if (buf.length < magic.length) return false;
  return magic.every((byte, i) => buf[i] === byte);
}

/**
 * Does `decoded` start with the magic bytes expected for `mediaType`?
 */
export function hasValidImageMagicBytes(
  decoded: Buffer,
  mediaType: "image/jpeg" | "image/png",
): boolean {
  return mediaType === "image/jpeg"
    ? hasMagicBytes(decoded, JPEG_MAGIC)
    : hasMagicBytes(decoded, PNG_MAGIC);
}
