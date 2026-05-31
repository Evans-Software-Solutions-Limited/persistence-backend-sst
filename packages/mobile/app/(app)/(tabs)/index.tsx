import { Link } from "expo-router";
import { Pressable, Text, View } from "react-native";
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
      <DevPrimitivesLink />
    </View>
  );
}

// TEMP(01-design-system): floating shortcut to the /dev/primitives inventory
// for the on-device design-system review. DELETE before merge — not part of
// the Home contract.
function DevPrimitivesLink() {
  return (
    <Link href={"/(dev)/primitives" as never} asChild>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Open design-system primitives (dev)"
        style={{
          position: "absolute",
          right: 16,
          bottom: 96,
          backgroundColor: "#22D3EE",
          paddingHorizontal: 14,
          paddingVertical: 10,
          borderRadius: 9999,
          shadowColor: "#000000",
          shadowOpacity: 0.4,
          shadowRadius: 8,
          shadowOffset: { width: 0, height: 4 },
          elevation: 6,
        }}
      >
        <Text style={{ color: "#042F39", fontWeight: "700", fontSize: 13 }}>
          ◇ Primitives
        </Text>
      </Pressable>
    </Link>
  );
}
