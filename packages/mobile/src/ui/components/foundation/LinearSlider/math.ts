/**
 * Pure gesture math for <LinearSlider> — touch-x → fraction → stepped value,
 * and the inverse (value → fraction, for rendering the thumb/fill position).
 *
 * Split out from the component so the gesture-callback logic is unit-testable
 * without mounting react-native-gesture-handler (which is globally mocked as
 * a no-op in `__tests__/setup.ts` — see `SemiCircleSlider`'s `Constants.ts`
 * for the established pattern this mirrors). All exports carry `'worklet'` so
 * they're callable from the UI-thread gesture callbacks.
 */

/** Touch-x (relative to the track's left edge) → clamped [0, 1] fraction. */
export function clampFraction(x: number, width: number): number {
  "worklet";
  if (width <= 0) return 0;
  return Math.max(0, Math.min(1, x / width));
}

/** Value → [0, 1] fraction across [min, max]. Inverse of {@link fractionToValue}. */
export function valueToFraction(
  value: number,
  min: number,
  max: number,
): number {
  "worklet";
  if (max === min) return 0;
  return Math.max(0, Math.min(1, (value - min) / (max - min)));
}

/**
 * How many decimal places `step` carries (e.g. 0.05 → 2), so
 * {@link fractionToValue} can round away binary-float noise (0.1 + 0.2-style
 * errors) instead of leaking them into the displayed/saved value.
 */
export function stepDecimalPlaces(step: number): number {
  "worklet";
  const s = String(step);
  const i = s.indexOf(".");
  return i === -1 ? 0 : s.length - i - 1;
}

/** [0, 1] fraction → the nearest `step`-quantised value in [min, max]. */
export function fractionToValue(
  fraction: number,
  min: number,
  max: number,
  step: number,
): number {
  "worklet";
  const clamped = Math.max(0, Math.min(1, fraction));
  const raw = min + clamped * (max - min);
  const stepped = step > 0 ? Math.round(raw / step) * step : raw;
  const decimals = stepDecimalPlaces(step);
  const rounded = decimals > 0 ? Number(stepped.toFixed(decimals)) : stepped;
  return Math.max(min, Math.min(max, rounded));
}
