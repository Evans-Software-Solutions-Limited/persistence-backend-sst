/**
 * Unicode-safe string truncation.
 *
 * ⚠ **This is a deliberate TWIN of
 * `microservices/core/src/application/loadout/modelProse.ts`, not an accident.**
 * `packages/mobile` shares no workspace package with `microservices/core` (it has no
 * `@persistence/*` dependencies at all — it is a standalone RN app), so the rule
 * cannot be imported. If you change the behaviour here, change it there too; the
 * backend copy carries the full explanation of the jsonb hazard behind it.
 *
 * ## Why a naive `slice()` is not good enough
 *
 * A cut can land between the two halves of a surrogate pair, leaving a lone
 * surrogate. That is not merely cosmetic:
 *
 * - **Postgres rejects an unpaired surrogate escape in jsonb input**, so a string
 *   round-tripped into `workout_exercises.substitution_reason` aborts the whole
 *   `createVariation` transaction as an opaque 500 — losing a reviewed adaptation.
 * - In a plain text column the driver replaces it with U+FFFD, so the user sees `�`
 *   in a name they never typed.
 *
 * Both are reachable with attacker-influenced input: AC-1.2 makes a stranger's
 * PUBLIC workout adaptable, and neither `workouts.name` nor `exercises.name` is
 * length-bounded at its create handler.
 */

/**
 * Remove surrogate code units with no partner, in either direction. Well-formed
 * pairs — and therefore every emoji — survive untouched.
 */
export function stripUnpairedSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
}

/**
 * Strip unpaired surrogates, then truncate to `maxLength` on a whole code point.
 *
 * Stripping happens FIRST so units that are about to be deleted do not consume
 * budget that real characters could have used.
 */
export function capText(text: string, maxLength: number): string {
  const paired = stripUnpairedSurrogates(text);
  if (paired.length <= maxLength) return paired;
  const cut = paired.slice(0, maxLength);
  const last = cut.charCodeAt(cut.length - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isHighSurrogate ? cut.slice(0, -1) : cut;
}
