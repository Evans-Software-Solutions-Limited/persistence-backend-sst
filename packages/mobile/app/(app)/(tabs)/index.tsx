import { View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CoachHomeContainer } from "../../../src/ui/containers/CoachHomeContainer";
import { HomeContainer } from "../../../src/ui/containers/HomeContainer";
import { SyncBlockedBannerMount } from "../../../src/ui/containers/SyncBlockedBannerMount";
import { SyncFailedBannerMount } from "../../../src/ui/containers/SyncFailedBannerMount";
import { useUserMode } from "../../../src/state/user-mode";

/**
 * Home tab — the first screen users land on after sign-in.
 *
 * Branches on `useUserMode().mode`: athletes get the dashboard
 * (`HomeContainer`, owned by 06-progress-goals); coaches get the
 * coaching dashboard (`CoachHomeContainer`, stub until M8 /
 * 10-trainer-features).
 *
 * Spec: specs/14-navigation/design.md § Route migration table (index.tsx)
 *       specs/14-navigation/requirements.md STORY-001 + STORY-002 (AC 2.1)
 *       specs/14-navigation/tasks.md T-14.3.7
 *       specs/06-progress-goals/design.md § Dashboard mobile architecture (M1)
 *       specs/11-payments-subscriptions/design.md § Sync-queue entitlement (M10.6)
 *       specs/milestones/M13-sync-hardening § Failed-sync review UI
 *
 * Both `SyncBlockedBannerMount` and `SyncFailedBannerMount` render nothing
 * when their respective queue is clean — no layout flicker, no banner-
 * shaped gap on cold start. Mounted ABOVE the body so they're the user's
 * first signal that something needs their attention. Both can be visible
 * at once (a plan-blocked mutation and a retry-exhausted one are
 * independent pools) — they stack, blocked-by-plan first since it has a
 * known, one-tap fix (upgrade) vs. sync-failed's Retry/Discard decision.
 */
export default function Home() {
  const mode = useUserMode((s) => s.mode);
  // Own the top safe-area HERE (not in HomePresenter) so it also clears the
  // status bar for the SyncBlockedBannerMount, which renders ABOVE the home
  // body. Padding it in the presenter too would double-offset the content.
  const insets = useSafeAreaInsets();

  return (
    <View style={{ flex: 1, paddingTop: insets.top }}>
      <SyncBlockedBannerMount />
      <SyncFailedBannerMount />
      {mode === "coach" ? <CoachHomeContainer /> : <HomeContainer />}
    </View>
  );
}
