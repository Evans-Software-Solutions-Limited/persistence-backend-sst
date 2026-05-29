import { Redirect, Stack } from "expo-router";

/**
 * Dev-only route group. Hosts the `/dev/primitives/*` + `/dev/fonts` smoke
 * routes (01-design-system STORY-002 AC 2.5, STORY-003 AC 3.9, STORY-009).
 * Gated behind `__DEV__` so the inventory routes never ship in a production
 * build — a release build redirects straight back to the app root.
 */
export default function DevLayout() {
  if (!__DEV__) {
    return <Redirect href="/" />;
  }
  return <Stack screenOptions={{ headerShown: true }} />;
}
