/** Entry formats only; profiles continue to store centimetres. */
export type HeightInputFormat = "cm" | "mcm" | "in" | "ftin";
export type HeightInputParts = { value: string; inches: string };
const number = (text: string): number | null => {
  const trimmed = text.trim().replace(",", ".");
  if (!/^\d+(?:\.\d*)?$/.test(trimmed)) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
};
export function parseHeightInput(
  parts: HeightInputParts,
  format: HeightInputFormat,
): number | null {
  const major = number(parts.value);
  if (major === null) return null;
  if (format === "cm") return major;
  if (format === "in") return major * 2.54;
  const minor = number(parts.inches);
  const base = format === "mcm" ? 100 : 12;
  if (!Number.isInteger(major) || minor === null || minor >= base) return null;
  return format === "mcm" ? major * 100 + minor : (major * 12 + minor) * 2.54;
}
export function formatHeightInput(
  cm: number | null,
  format: HeightInputFormat,
): HeightInputParts {
  if (cm === null) return { value: "", inches: "" };
  const rounded = (n: number) => String(Math.round(n * 100) / 100);
  if (format === "cm") return { value: rounded(cm), inches: "" };
  if (format === "in") return { value: rounded(cm / 2.54), inches: "" };
  const total = Math.round((format === "mcm" ? cm : cm / 2.54) * 100) / 100;
  const base = format === "mcm" ? 100 : 12;
  return {
    value: String(Math.floor(total / base)),
    inches: rounded(total % base),
  };
}
