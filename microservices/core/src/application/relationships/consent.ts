/**
 * 26-coach-data-sharing-consent — shared constants for the coach data-sharing
 * consent mechanism (UK GDPR Art 9(2)(a) explicit consent).
 */

/**
 * The current consent copy/scope version, stamped on every
 * `data_sharing_consents` row and on `pt_client_relationships.consent_version`
 * at grant time. Bump this string whenever the consent copy or the scope of
 * shared data categories changes — a version bump does NOT retroactively
 * invalidate consent already recorded against the prior version; it only
 * applies to new grants going forward.
 *
 * Mirrored on mobile as `CONSENT_VERSION` (packages/mobile) with a
 * `// keep in sync with backend CONSENT_VERSION` comment — the string is a
 * shared contract between the two, not derived at runtime.
 */
export const CONSENT_VERSION = "v1-2026-07";

/**
 * Where a `data_sharing_consents` row's grant/withdraw event originated.
 * Threaded through as `source` on every insert (recordDataSharingConsent.ts).
 */
export type ConsentSource =
  | "invite_accept"
  | "invite_code_redeem"
  | "leave_coach"
  | "coach_removed";
