/**
 * The website's origin, as this API understands it.
 *
 * ONE definition, because two consumers must agree on it exactly: the founding
 * checkout builds Stripe's `success_url`/`cancel_url` from it, and the admin
 * CORS policy allows requests from it. If those two ever drifted, either
 * buyers would be returned to the wrong host or the admin panel would be
 * refused by its own API.
 *
 * Falls back on an EMPTY value, not just an absent one: `infra/api.ts` sets
 * optional vars to `""` rather than leaving them unset, and `??` would happily
 * pass that through — making `success_url` a relative path (which Stripe
 * rejects) and the CORS allow-list a comparison against `""` (which no browser
 * ever sends).
 */
export function webOrigin(): string {
  return (
    // Trailing slashes are stripped because a browser's `Origin` never has
    // one: `WEB_ORIGIN=https://host/` would refuse the whole admin panel
    // through a string comparison that never matches, with nothing logged.
    // Two other consumers already defend against exactly this input
    // (`foundingInviteEmail.ts`, `admin/adminApi.ts`), which is why it is
    // handled here rather than assumed away.
    process.env.WEB_ORIGIN?.trim().replace(/\/+$/, "") ||
    "https://persistence.evans-software-solutions.com"
  );
}
