/* eslint-disable @typescript-eslint/no-explicit-any */
export function parseNutritionValue(v: any): number | null {
  if (typeof v === "number") {
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  if (typeof v !== "string") return null;
  const cleaned = v
    .replace(/(\d),(?=\d{3}(\D|$))/g, "$1") // thousands separator → strip
    .replace(/(\d),(\d{1,2})(?!\d)/, "$1.$2"); // European decimal → point
  const m = cleaned.match(/^\s*(\d+(?:\.\d+)?)/);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n >= 0 ? n : null;
}
