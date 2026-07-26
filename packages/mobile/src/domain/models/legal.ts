/**
 * Shared legal document URLs surfaced in-app.
 *
 * Single source of truth — do not inline these strings at call sites. Apple
 * App Review checks that the Terms of Use (EULA) and Privacy Policy links are
 * *functional* both in the binary (Guideline 3.1.2, at the point of purchase)
 * and in the App Store Connect metadata (App Description). A dead or missing
 * link here is a hard rejection, not a warning.
 */

/**
 * Terms of Use (EULA).
 *
 * Persistence uses Apple's **standard** EULA rather than a custom licence
 * agreement, so this points at Apple's canonical hosted copy. The same URL is
 * carried in the App Store Connect App Description.
 *
 * If we ever switch to a custom EULA, this must change to
 * `https://persistence.evans-software-solutions.com/terms` AND the custom
 * agreement must be uploaded in App Store Connect → App Information → Licence
 * Agreement. Changing one without the other re-triggers the metadata rejection.
 *
 * @see https://developer.apple.com/app-store/review/guidelines/#3.1.2
 */
export const TERMS_OF_USE_URL =
  "https://www.apple.com/legal/internet-services/itunes/dev/stdeula/";

/**
 * Privacy policy, hosted on our marketing site (`packages/web` → `/privacy`).
 * Also the URL registered in App Store Connect's Privacy Policy field.
 */
export const PRIVACY_POLICY_URL =
  "https://persistence.evans-software-solutions.com/privacy";

/**
 * Our own terms page (`packages/web` → `/terms`). Supplementary to the Apple
 * standard EULA above — service terms, health disclaimer, governing law. Not
 * the EULA, and must not be presented as one while `TERMS_OF_USE_URL` points
 * at Apple's standard agreement.
 */
export const SERVICE_TERMS_URL =
  "https://persistence.evans-software-solutions.com/terms";
