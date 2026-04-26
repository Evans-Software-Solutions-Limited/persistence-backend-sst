import * as Device from "expo-device";
import { Platform } from "react-native";
import type { HealthPort } from "@/domain/ports/health.port";
import { AndroidStubHealthAdapter } from "./android-stub.adapter";
import { ExpoHealthKitAdapter } from "./expo-healthkit.adapter";
import { SimulatorMockHealthAdapter } from "./simulator-mock.adapter";
import { StubHealthAdapter } from "./stub.adapter";

export { StubHealthAdapter } from "./stub.adapter";
export { ExpoHealthKitAdapter } from "./expo-healthkit.adapter";
export { SimulatorMockHealthAdapter } from "./simulator-mock.adapter";
export { AndroidStubHealthAdapter } from "./android-stub.adapter";

/**
 * Picks the right `HealthPort` implementation for the current runtime.
 *
 * Selection rules (see `specs/07-health-integration/design.md` § M1
 * scope > Selection logic):
 *
 * - **iOS real device** → `ExpoHealthKitAdapter` (real HealthKit reads).
 * - **iOS simulator** (`__DEV__ && !Device.isDevice`) →
 *   `SimulatorMockHealthAdapter` so the StepsTile renders deterministic
 *   values during smoke-testing.
 * - **Android** (any build) → `AndroidStubHealthAdapter` — Health
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
    if (__DEV__ && !Device.isDevice) {
      return new SimulatorMockHealthAdapter();
    }
    return new ExpoHealthKitAdapter();
  }
  if (Platform.OS === "android") {
    return new AndroidStubHealthAdapter();
  }
  return new StubHealthAdapter();
}
