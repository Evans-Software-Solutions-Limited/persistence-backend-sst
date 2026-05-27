import { View } from "react-native";
import { HomeContainer } from "../../../src/ui/containers/HomeContainer";
import { SyncBlockedBannerMount } from "../../../src/ui/containers/SyncBlockedBannerMount";

/**
 * Home tab — the first screen users land on after sign-in.
 *
 * Spec: specs/06-progress-goals/design.md § Dashboard mobile architecture
 *       (M1) · requirements.md STORY-005
 *       specs/11-payments-subscriptions/design.md § Sync-queue
 *       entitlement handling (M10.6) > UI (AC 12.4 — banner at top
 *       of Home tab when blocked entries exist)
 *
 * The `SyncBlockedBannerMount` renders nothing when the queue is
 * clean — no layout flicker, no banner-shaped gap on cold start.
 * Mounted ABOVE `HomeContainer` so it's the user's first signal that
 * something needs their attention.
 */
export default function Home() {
  return (
    <View style={{ flex: 1 }}>
      <SyncBlockedBannerMount />
      <HomeContainer />
    </View>
  );
}
