/**
 * Image transport sizing for the AI photo endpoints.
 *
 * ## ⚠ The bug this exists to fix
 *
 * `SnapAISheetContainer` has resized with `[{ resize: { width: MAX_DIMENSION } }]`
 * since M9.5, while its own doc comment (and design § 8.1 for the equipment scan)
 * describes a **long-edge** cap. Width-only resizing is wrong in both directions:
 *
 *  - **A portrait photo still blows the cap.** A 3024 × 4032 phone photo becomes
 *    1080 × 1440 — the long edge is 1440, a third over budget, on the axis that
 *    costs the most tokens. Every portrait shot has been oversized.
 *  - **A small image is UPSCALED.** `expo-image-manipulator` resizes to the given
 *    width whether that is smaller or larger, so an 800 px screenshot is blown up
 *    to 1080 px: strictly more bytes, strictly no more detail, and a slower call.
 *
 * That matters more for the equipment scan than for Snap AI: the scan is
 * Opus-class at $0.0272 an inference, five times the unit cost, on a 6/day
 * ceiling — and it is the slowest call in the app (E1 measured mean 10.1 s / max
 * 12.3 s), inside a route budget with only ~5 s of headroom.
 */

/** `expo-image-manipulator` accepts exactly one axis; the other is derived. */
export type ResizeAction = {
  readonly resize: { width: number } | { height: number };
};

/**
 * Resize actions that cap the LONG edge at `maxDimension`, preserving aspect
 * ratio and **never upscaling**.
 *
 * Returns an empty array when the image is already within budget — an empty
 * action list is a valid `manipulateAsync` argument and still applies the
 * compression/format options, so this is a no-op resize rather than a skipped
 * compress.
 *
 * Non-finite or non-positive dimensions (some library assets report 0 before
 * they are decoded) fall back to capping the WIDTH, which is the pre-existing
 * behaviour: with no dimensions to reason about, the old bug is a safer default
 * than returning `[]` and posting a full-resolution photo.
 */
export function resizeToLongEdge(
  width: number,
  height: number,
  maxDimension: number,
): ResizeAction[] {
  const usable =
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width > 0 &&
    height > 0;
  if (!usable) return [{ resize: { width: maxDimension } }];
  if (width <= maxDimension && height <= maxDimension) return [];
  return width >= height
    ? [{ resize: { width: maxDimension } }]
    : [{ resize: { height: maxDimension } }];
}
