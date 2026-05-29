import { Stack } from "expo-router";

/**
 * /dev/primitives/* — per-primitive inventory routes (01-design-system
 * STORY-003 AC 3.9, STORY-009). Inherits the (dev) group's __DEV__ gate.
 */
export default function PrimitivesDevLayout() {
  return <Stack screenOptions={{ headerShown: true }} />;
}
