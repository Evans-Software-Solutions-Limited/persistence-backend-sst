/**
 * Safety rules for the one thing a Loadout model is allowed to write in its own
 * words: a short sentence shown to the user.
 *
 * Both Loadout AI surfaces have such a field — the re-map's per-row
 * `SubstitutionReason.note` (§ 7.2) and the scan's `notes` (§ 8.1) — and both are
 * reachable by an attacker, so the rule lives here once rather than being
 * re-derived per surface. This is NOT the shared "Loadout AI service" design § 1b
 * forbids: it is a string sanitiser with no model, client, prompt or ceiling in
 * it. The two surfaces still have their own model ids, ceilings and kill switches.
 *
 * ## Why the prose is untrusted on BOTH surfaces
 *
 * - **Re-map:** AC-1.2 makes a stranger's PUBLIC workout adaptable, and neither
 *   `workouts.name` nor `exercises.name` is length-bounded at its create handler,
 *   so an attacker can publish a workout whose names instruct the model what to
 *   write.
 * - **Scan:** the input is a photograph the caller chose. A photo of text — a
 *   whiteboard, a printed sheet held up to the lens — puts attacker-chosen
 *   instructions in front of a vision model just as effectively as a string does.
 *
 * Membership validation (§ 1 rule 1) keeps the *selections* legal on both
 * surfaces regardless. The prose is the only steerable channel, which is why it
 * is bounded here and why **every render boundary must treat it as plain text —
 * never markup, a link, or anything actionable.**
 *
 * ## Why unpaired surrogates are stripped rather than escaped
 *
 * `JSON.stringify` happily emits a lone `\udXXX`, so a response carrying one is a
 * clean 200 — but the client round-trips the re-map's string back into
 * `POST /workouts/:id/variations` as `substitutionReason`, and **Postgres rejects
 * an unpaired surrogate escape in jsonb input**, aborting the whole
 * `createVariation` transaction as an opaque 500 and losing the user's reviewed
 * adaptation. Bedrock can return such an escape in a tool payload, so stripping
 * only the ones a length cut would create would leave that guarantee untrue.
 */

/**
 * Remove surrogate code units that have no partner, in either direction. Well-
 * formed pairs (and therefore every emoji) survive untouched.
 */
export function stripUnpairedSurrogates(text: string): string {
  return text.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    "",
  );
}

/**
 * Strip unpaired surrogates, then trim to `maxLength` on a whole CODE POINT.
 *
 * A bare `slice()` can cut between the halves of a surrogate pair and reintroduce
 * exactly the lone surrogate this module exists to prevent, so the trailing high
 * surrogate is dropped when the cut lands mid-pair.
 */
export function capModelProse(text: string, maxLength: number): string {
  const paired = stripUnpairedSurrogates(text);
  if (paired.length <= maxLength) return paired;
  const cut = paired.slice(0, maxLength);
  const last = cut.charCodeAt(cut.length - 1);
  const isHighSurrogate = last >= 0xd800 && last <= 0xdbff;
  return isHighSurrogate ? cut.slice(0, -1) : cut;
}
