/**
 * 26-coach-data-sharing-consent — shared constants for the coach data-sharing
 * consent mechanism (UK GDPR Art 9(2)(a) explicit consent), mobile side.
 *
 * Backend source of truth:
 *   microservices/core/src/application/relationships/consent.ts
 */

/**
 * The current consent copy/scope version, sent as `consentVersion` on every
 * accept (`POST /clients/me/relationships/:id/respond`) and invite-code
 * redeem (`POST /trainers/accept-invite-code`) call.
 *
 * keep in sync with backend CONSENT_VERSION
 * (microservices/core/src/application/relationships/consent.ts) — this is a
 * shared string contract between the two, not derived at runtime. Bump both
 * together whenever the consent copy or the scope of shared data categories
 * changes.
 */
export const CONSENT_VERSION = "v1-2026-07";

/**
 * The privacy policy the consent step links out to
 * (`DataSharingConsentSheet`'s "Read our Privacy Policy" link), opened via
 * the app's existing `Linking.openURL` mechanism (react-native core, not
 * `expo-linking`'s `createURL` — this is an external https URL, not an
 * in-app deep link).
 */
export const PRIVACY_POLICY_URL =
  "https://persistence.evans-software-solutions.com/privacy";
