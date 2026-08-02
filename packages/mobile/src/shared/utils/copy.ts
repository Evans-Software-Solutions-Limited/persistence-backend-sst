/**
 * Small user-facing copy helpers.
 *
 * Deliberately NOT in `./text`: that module carries a twin contract with
 * `microservices/core/src/application/loadout/modelProse.ts` and a
 * security-relevant rule about unpaired surrogates aborting `createVariation`.
 * Copy helpers have no backend counterpart, and parking them there would make
 * that contract read as if it governed them too.
 */

/**
 * "1 item" / "5 items" — the equipment count as Loadout's CTAs and gym rows say
 * it.
 *
 * Shared because it had been written four times and two of those copies dropped
 * the singular ("Adapt to 1 items", "Use these 1 items"), both reachable the
 * moment a scan finds one thing or a user ticks one chip.
 */
export function itemLabel(count: number): string {
  return count === 1 ? "1 item" : `${count} items`;
}
