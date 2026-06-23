import React, { useCallback, useMemo, useState } from "react";
import { ActivityIndicator, StyleSheet, View } from "react-native";
import { router } from "expo-router";
import { FeatureGatePrompt } from "@/ui/components/subscription/FeatureGatePrompt";
import { useFeatureGate } from "@/ui/hooks/useFeatureGate";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { useModeSwitch } from "@/ui/hooks/useModeSwitch";
import { useAddClientSheet } from "@/state/add-client-sheet";
import { Colors } from "@/ui/theme/subscriptionLegacyTheme";
import {
  ClientsListPresenter,
  type ClientSegment,
} from "@/ui/presenters/coach/ClientsListPresenter";

/**
 * Trainer "Clients" tab container — the client roster (M8 / 10-trainer-features
 * Clients-list slice). Replaces the M10.5 Wave 2 `ComingSoon` placeholder with
 * the real roster, behind the unchanged feature gate.
 *
 * Three rendering branches (the first two are UNCHANGED from the Wave 2 stub):
 *
 *  - Subscription cache hasn't loaded → spinner.
 *  - `useFeatureGate('trainer_clients')` denies → paywall card.
 *  - Allowed → the live roster: cache-first `useGetTrainerClients()` wired into
 *    <ClientsListPresenter> with local search + segmented-filter state.
 *
 * The header `+` opens the existing root-mounted AddClient sheet
 * (`useAddClientSheet`, shipped in #123); a successful invite refreshes the
 * roster via the registered `onInvited` callback. Row press pushes the (stub)
 * per-client detail route — Client Detail proper is the next slice (10.9.3).
 *
 * Spec: specs/10-trainer-features/requirements.md STORY-002;
 *       specs/milestones/M8-coach/CLIENTS_LIST_BRIEF.md (Frontend slice).
 */
export function ClientsContainer() {
  const subQuery = useMySubscription();
  const gate = useFeatureGate("trainer_clients");
  const roster = useGetTrainerClients();
  const openSheet = useAddClientSheet((s) => s.openSheet);
  const { switchMode } = useModeSwitch();

  const [searchQuery, setSearchQuery] = useState("");
  const [segment, setSegment] = useState<ClientSegment>("Active");

  const clients = useMemo(() => roster.data ?? [], [roster.data]);
  const activeCount = useMemo(
    () => clients.filter((c) => c.status === "active").length,
    [clients],
  );

  const refreshRoster = roster.refresh;
  const onInvite = useCallback(() => {
    // Register the roster refresh so a successful invite re-pulls the list.
    openSheet(() => {
      void refreshRoster();
    });
  }, [openSheet, refreshRoster]);

  const onOpenClient = useCallback((id: string) => {
    router.push(`/(app)/clients/${id}`);
  }, []);

  const onSwitchToAthlete = useCallback(() => {
    void switchMode("athlete", "clients");
  }, [switchMode]);

  // Subscription cache not resolved yet — defensive spinner. Once the query
  // lands the gate's `reason: 'unknown'` falls through to a real verdict on
  // the next render.
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
    <ClientsListPresenter
      clients={clients}
      activeCount={activeCount}
      searchQuery={searchQuery}
      onSearchChange={setSearchQuery}
      segment={segment}
      onSegmentChange={setSegment}
      isLoading={
        (roster.isRefreshing || (roster.isStale && roster.error === null)) &&
        roster.data === null
      }
      isRefreshing={roster.isRefreshing}
      error={roster.error}
      onRefresh={refreshRoster}
      onInvite={onInvite}
      onOpenClient={onOpenClient}
      onSwitchToAthlete={onSwitchToAthlete}
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
