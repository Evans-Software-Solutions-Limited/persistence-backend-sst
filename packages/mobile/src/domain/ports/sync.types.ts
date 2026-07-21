import type { EntitlementFeature } from "@/domain/models/entitlement";
import type { SubscriptionTierName } from "@/domain/models/subscription";

export type SyncOperation = "create" | "update" | "delete";

/**
 * Sync-queue entry lifecycle states.
 *
 * - `pending`  — queued, not yet attempted (or re-queued after explicit unblock).
 * - `in_flight` — currently being POSTed by a drain. Row-conditional via
 *   `markMutationInFlight`; see storage.port.ts for the race-guard details.
 * - `failed`   — last attempt failed (network/5xx/validation). Re-claimable
 *   by the next drain up to `max_retries`.
 * - `completed` — successfully synced; awaiting prune.
 * - `blocked_entitlement` (M10.6) — server returned HTTP 402 with
 *   `code: "ENTITLEMENT_DENIED"`. The user's current plan doesn't cover this
 *   mutation. Retrying without a tier change won't help, so the worker skips
 *   these entries on subsequent flushes — the only paths out are an explicit
 *   user retry on the sync-blocked screen, a discard, or an automatic tier-
 *   change unblock via `useAutoRetryOnUpgrade`. The captured verdict on the
 *   entry powers the UI (which feature, which upgrade target, what price).
 *
 * Spec: specs/11-payments-subscriptions/design.md § Sync-queue entitlement handling (M10.6)
 * Satisfies: requirements.md AC 12.1, 12.2, 12.6
 */
export type SyncStatus =
  | "pending"
  | "in_flight"
  | "failed"
  | "completed"
  | "blocked_entitlement"
  // A permanent client error (4xx except 401/402/403/408/429): retrying the same request
  // can never succeed, so the drain must NOT auto-retry it (that just burns
  // the retry budget and reports "exhausted retries" as if it were transient).
  // Excluded from `getPendingMutations`, but surfaced via
  // `getFailedExhaustedEntries` + recoverable via `resetFailedEntries` (e.g.
  // after an app update fixes the underlying request), same as an exhausted
  // `failed` entry.
  | "permanently_failed";

/**
 * Server's entitlement verdict captured on a `blocked_entitlement` entry.
 * Mirrors `ApiErrorEntitlementPayload` (the camelCase shape the
 * `SSTApiAdapter` already parses out of the 402 body) plus `blockedAt`
 * so the UI can sort or render "blocked X minutes ago".
 *
 * `upgradeTo === null` → user is already at the top tier on this track,
 * so the review screen surfaces "Contact support" instead of "Upgrade".
 * Matches the FeatureGatePrompt's same edge case.
 */
export type EntitlementVerdict = {
  feature: EntitlementFeature;
  currentTier: SubscriptionTierName;
  upgradeTo: SubscriptionTierName | null;
  upgradePriceMonthly: number | null;
  /** ISO timestamp recorded at the moment the 402 landed. */
  blockedAt: string;
};
