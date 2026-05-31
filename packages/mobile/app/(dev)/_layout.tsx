import { Stack } from "expo-router";

/**
 * Dev-only route group. Hosts the `/dev/primitives/*` + `/dev/fonts` smoke
 * routes (01-design-system STORY-002 AC 2.5, STORY-003 AC 3.9, STORY-009).
 *
 * TEMP(01-design-system): the `__DEV__` redirect gate is removed for the
 * on-device design-system review so the inventory is reachable from any build.
 * RESTORE the gate (or delete the whole `(dev)` group per
 * 12-production-readiness T-12.1.6) before merging.
 */
export default function DevLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
