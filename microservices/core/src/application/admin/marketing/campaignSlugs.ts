/**
 * The campaign slugs the marketing site knows about.
 *
 * ⚠ DUPLICATED, on purpose. The authority is `CAMPAIGNS` in
 * `packages/web/src/marketing/config.ts` — it drives the landing routes, the
 * Apple `ct` tokens and the printed `/g/<slug>` QR table, and it cannot move
 * here without either a shared package or `packages/web` importing a value out
 * of the core API bundle. Neither is worth it for a list of eight words.
 *
 * The drift that duplication invites is closed by a test instead:
 * `packages/web/src/marketing/__tests__/campaignSlugsParity.test.ts` reads this
 * file and fails if the two lists disagree. Add a slug there first, then here.
 *
 * `default` is excluded: it is the attribution bucket an unrecognised
 * `/qr/<slug>` falls into, not a channel anyone would plan a campaign around.
 */
export const ADMIN_CAMPAIGN_SLUGS: readonly string[] = [
  "uon",
  "flyer",
  "banner",
  "social",
  "tt",
  "ig",
  "li",
  "meta",
];

/** Shape every slug — ours and any hand-typed one — must satisfy. */
export const CAMPAIGN_SLUG_PATTERN = /^[a-z0-9-]{1,32}$/;

export function isKnownCampaignSlug(slug: string): boolean {
  return ADMIN_CAMPAIGN_SLUGS.includes(slug);
}
