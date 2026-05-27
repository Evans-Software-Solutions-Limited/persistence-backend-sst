import React from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { ComingSoon } from "@/ui/components/ComingSoon";
import { FeatureGatePrompt } from "@/ui/components/subscription/FeatureGatePrompt";
import { useFeatureGate } from "@/ui/hooks/useFeatureGate";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { Colors } from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Trainer "Clients" tab container — M10.5 Wave 2 stub gate.
 *
 * Spec: specs/11-payments-subscriptions/design.md
 *       § Per-screen feature-gate integration (Wave 2)
 *       § Trainer routes — stub gate when accessed by non-trainer or free
 *       trainer tier
 * Closes: specs/11-payments-subscriptions/tasks.md Phase 12 (m105-gates-trainer)
 * Satisfies: specs/11-payments-subscriptions/requirements.md AC 4.6, 6.1
 *
 * Wave 2 only wires the gate primitive on this surface. M8 owns the
 * actual client-management UI; until then we render a `ComingSoon`-style
 * placeholder for entitled trainers and the `FeatureGatePrompt` for
 * non-trainer (or unentitled) users.
 *
 * Three rendering branches:
 *
 *  - Subscription cache hasn't loaded → spinner.
 *  - `useFeatureGate('trainer_clients')` denies → paywall card.
 *    `useFeatureGate` already wires `onUpgrade` to push into Selection
 *    with the right tier query param; we pass `gateProps` straight to
 *    the prompt.
 *  - Allowed → M8 "Coming Soon" placeholder.
 *
 * The container intentionally never renders a "you're a trainer but
 * we hid the tab" fallback — the tab-bar visibility lives in
 * `_layout.tsx` and trainer users see the tab. Non-trainer users only
 * reach this route if they followed a direct link (e.g. the Manage
 * Clients button on the post-payment Success screen when their tier
 * isn't actually a trainer tier; an edge case that shouldn't happen
 * but is defended against here).
 */
export function ClientsContainer() {
  const subQuery = useMySubscription();
  const gate = useFeatureGate("trainer_clients");

  // Subscription cache not resolved yet — defensive spinner. Once the
  // query lands the gate's `reason: 'unknown'` falls through to a real
  // verdict on the next render.
  if (subQuery.isPending) {
    return (
      <View style={styles.loading} testID="clients-loading">
        <ActivityIndicator size="large" color={Colors.primary.DEFAULT} />
      </View>
    );
  }

  if (!gate.allowed) {
    return (
      <View style={styles.gateWrapper} testID="clients-gate">
        <FeatureGatePrompt {...gate.gateProps} />
      </View>
    );
  }

  return (
    <ComingSoon
      icon="people-outline"
      title="Clients"
      description="Trainer client management arrives in milestone M8."
      testID="clients-coming-soon"
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: Colors.background.primary,
  },
  gateWrapper: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: Colors.background.primary,
  },
});
