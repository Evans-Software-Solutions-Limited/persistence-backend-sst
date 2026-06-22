import { useWindowDimensions } from "react-native";

/** Horizontal padding on the auth screens — space.$xl (24) on each side. */
const AUTH_HORIZONTAL_PADDING = 48;
/** Width the wordmark (34px / 6 letter-spacing) was designed against. */
const REFERENCE_WIDTH = 393;
/** Floor — keeps the wordmark legible on very narrow devices. */
const MIN_SCALE = 0.6;
/** Design-size font size + letter-spacing for the "PERSISTENCE" wordmark. */
const BASE_FONT_SIZE = 34;
const BASE_LETTER_SPACING = 6;

export type BrandTitleStyle = { fontSize: number; letterSpacing: number };

/**
 * Pure scale calc, exported for tests. The wordmark renders at a fixed
 * 34px / 6px letter-spacing which overflows (and wraps to two lines) on
 * devices narrower than the reference width. Both the font size and the
 * letter-spacing scale linearly with width, as does the available space,
 * so scaling both by `available / referenceAvailable` keeps the wordmark
 * on one line at any width — and clamps to the original size on wider
 * screens.
 */
export function brandTitleStyle(width: number): BrandTitleStyle {
  const available = width - AUTH_HORIZONTAL_PADDING;
  const reference = REFERENCE_WIDTH - AUTH_HORIZONTAL_PADDING;
  const scale =
    width > 0 ? Math.max(MIN_SCALE, Math.min(1, available / reference)) : 1;
  return {
    fontSize: Math.round(BASE_FONT_SIZE * scale),
    letterSpacing: BASE_LETTER_SPACING * scale,
  };
}

/**
 * Responsive font size + letter-spacing for the "PERSISTENCE" brand
 * wordmark on the auth screens, so it never wraps on narrow devices.
 */
export function useBrandTitleStyle(): BrandTitleStyle {
  const { width } = useWindowDimensions();
  return brandTitleStyle(width);
}
