/**
 * Read the amount off an imported recipe ingredient line (PER-78).
 *
 * URL import and "paste a recipe" hand the create form free-text lines such
 * as "400g chicken thighs, diced". Seeding those rows with no quantity meant
 * linking a food (or resolving it with AI) filled in the food's own reference
 * serving — usually 100 g — instead of the 400 g the recipe stated.
 *
 * Deliberately conservative: only a clear leading amount in a MASS unit is
 * read, because mass converts to the food's gram basis exactly (`./units`).
 * Volume (tbsp, cups, ml), counts ("2 eggs"), ranges ("2-3 cloves"),
 * multipliers ("2 x 400g tins") and lines with no amount are left for the
 * user to review — the amount stays visible in the line's text and is never
 * replaced by an invented default.
 */

export type ParsedIngredientLine = {
  /** The line without its amount, or the whole line when nothing was read. */
  name: string;
  /** Amount in `unit`; null when the line needs the user to set it. */
  quantity: number | null;
  /** Canonical mass unit ("g", "kg", "oz", "lb"), or "" when not read. */
  unit: string;
};

const UNICODE_FRACTIONS: Record<string, number> = {
  "½": 1 / 2,
  "⅓": 1 / 3,
  "⅔": 2 / 3,
  "¼": 1 / 4,
  "¾": 3 / 4,
  "⅕": 1 / 5,
  "⅛": 1 / 8,
  "⅜": 3 / 8,
  "⅝": 5 / 8,
  "⅞": 7 / 8,
};

const MASS_UNITS: Record<string, string> = {
  g: "g",
  gr: "g",
  gram: "g",
  grams: "g",
  gramme: "g",
  grammes: "g",
  kg: "kg",
  kgs: "kg",
  kilo: "kg",
  kilos: "kg",
  kilogram: "kg",
  kilograms: "kg",
  oz: "oz",
  ounce: "oz",
  ounces: "oz",
  lb: "lb",
  lbs: "lb",
  pound: "lb",
  pounds: "lb",
};

const FRACTION_CHARS = Object.keys(UNICODE_FRACTIONS).join("");
// A leading amount: "1 1/2", "1/2", "1½", "½", "1.5", "1,5", "400".
const AMOUNT_RE = new RegExp(
  `^(\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d*\\s?[${FRACTION_CHARS}]|\\d+(?:[.,]\\d+)?)`,
);
// The unit straight after the amount, ending at a word boundary so "2 large"
// never reads as litres and "1 green" never reads as grams.
const UNIT_RE = /^\s*([a-z]+)\.?(?=$|[\s,;:)(/])/i;
// A dual measure after the amount ("200g/7oz flour") — the first one is kept.
const ALT_MEASURE_RE = /^\s*\/\s*[\d.,½¼¾⅓⅔]+\s*[a-z]+\.?/i;
const RANGE_OR_MULTIPLIER_RE = /^\s*(?:-|–|—|to\b|x\b|×)/i;

function amountValue(text: string): number | null {
  const t = text.trim();
  const mixed = t.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const den = Number(mixed[3]);
    return den > 0 ? Number(mixed[1]) + Number(mixed[2]) / den : null;
  }
  const frac = t.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const den = Number(frac[2]);
    return den > 0 ? Number(frac[1]) / den : null;
  }
  const uni = t.match(new RegExp(`^(\\d*)\\s?([${FRACTION_CHARS}])$`));
  if (uni) return Number(uni[1] || 0) + UNICODE_FRACTIONS[uni[2]];
  // "1,000" is a thousands separator; "1,5" is a decimal comma.
  const n = /^\d{1,3}(?:,\d{3})+$/.test(t)
    ? Number(t.replace(/,/g, ""))
    : Number(t.replace(",", "."));
  return Number.isFinite(n) ? n : null;
}

export function parseIngredientLine(line: string): ParsedIngredientLine {
  const original = line.trim();
  const unread = { name: original, quantity: null, unit: "" };
  const text = original.replace(/^[-•*·]\s*/, "");
  const amount = text.match(AMOUNT_RE);
  if (!amount) return unread;
  const afterAmount = text.slice(amount[0].length);
  if (RANGE_OR_MULTIPLIER_RE.test(afterAmount)) return unread;
  const unitMatch = afterAmount.match(UNIT_RE);
  const unit = unitMatch ? MASS_UNITS[unitMatch[1].toLowerCase()] : undefined;
  if (!unitMatch || !unit) return unread;
  const quantity = amountValue(amount[0]);
  if (quantity === null || !(quantity > 0)) return unread;
  const name = afterAmount
    .slice(unitMatch[0].length)
    .replace(ALT_MEASURE_RE, "")
    .replace(/^[\s,]*(?:of\s+)?/i, "")
    .trim();
  if (!name) return unread;
  return { name, quantity: Math.round(quantity * 1000) / 1000, unit };
}
