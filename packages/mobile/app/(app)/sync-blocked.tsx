import { SyncBlockedContainer } from "../../src/ui/containers/SyncBlockedContainer";

/**
 * Sync-blocked review screen — thin wrapper around `SyncBlockedContainer`.
 *
 * Lists sync-queue entries the server rejected with HTTP 402 +
 * `code: "ENTITLEMENT_DENIED"`, grouped by upgrade-target tier, with
 * per-group Upgrade-and-retry / Discard CTAs.
 *
 * Reached from the `SyncBlockedBanner` on the Home tab (AC 12.4).
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Sync-queue entitlement handling (M10.6) > UI
 * Satisfies: requirements.md AC 12.4, 12.5
 */
export default function SyncBlockedScreen() {
  return <SyncBlockedContainer />;
}
