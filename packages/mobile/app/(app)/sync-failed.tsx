import { SyncFailedContainer } from "../../src/ui/containers/SyncFailedContainer";

/**
 * Failed-sync review screen — thin wrapper around `SyncFailedContainer`.
 *
 * Lists sync-queue entries that exhausted their retry budget
 * (`status='failed' AND retry_count >= max_retries`), with per-entry
 * Retry / Discard CTAs.
 *
 * Reached from the `SyncFailedBanner` on the Home tab.
 *
 * Spec: specs/milestones/M13-sync-hardening § Failed-sync review UI
 */
export default function SyncFailedScreen() {
  return <SyncFailedContainer />;
}
