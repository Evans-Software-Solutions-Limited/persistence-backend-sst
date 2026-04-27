import { Platform } from "react-native";
import type { HealthPort } from "@/domain/ports/health.port";
import { AndroidStubHealthAdapter } from "./android-stub.adapter";
import { ExpoHealthKitAdapter } from "./expo-healthkit.adapter";
import { StubHealthAdapter } from "./stub.adapter";

export { StubHealthAdapter } from "./stub.adapter";
export { ExpoHealthKitAdapter } from "./expo-healthkit.adapter";
export { AndroidStubHealthAdapter } from "./android-stub.adapter";

/**
 * Picks the right `HealthPort` implementation for the current runtime.
 *
 * Selection rules:
 *
 * - **iOS** (device or simulator) → `ExpoHealthKitAdapter`. On the
 *   simulator, HealthKit reports `isAvailable: false`; tiles render
 *   their "Health not available on this iOS build" state honestly
 *   rather than papering over with a fixture. The earlier
 *   simulator-mock adapter was removed because Brad called the
 *   disclosure-chip approach unsatisfactory and asked for live data
 *   regardless — see PR #38 review.
 * - **Android** (any build) → `AndroidStubHealthAdapter`. Health
 *   Connect is deferred past M1.
 * - **Web / unknown** → `StubHealthAdapter` from 00-guardrails.
 *
 * Called once at `AdapterProvider` construction, not per hook.
 *
 * Spec: specs/07-health-integration/design.md § M1 scope > Selection
 *       logic · requirements.md STORY-007 AC 7.4
 */
export function createHealthAdapter(): HealthPort {
  if (Platform.OS === "ios") {
    return new ExpoHealthKitAdapter();
  }
  if (Platform.OS === "android") {
    return new AndroidStubHealthAdapter();
  }
  return new StubHealthAdapter();
}
