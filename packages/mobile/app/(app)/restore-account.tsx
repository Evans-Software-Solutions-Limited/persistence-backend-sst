import { RestoreAccountContainer } from "../../src/ui/containers/RestoreAccountContainer";

/**
 * Restore-account gate screen — thin wrapper around
 * `RestoreAccountContainer` (Cluster 2b account-deletion soft-delete).
 *
 * Reached only via `AuthGate`'s (app/_layout.tsx) soft-delete redirect —
 * never navigated to directly.
 */
export default function RestoreAccountScreen() {
  return <RestoreAccountContainer />;
}
