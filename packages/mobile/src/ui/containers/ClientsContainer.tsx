import React, { useCallback, useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import { router, useLocalSearchParams, type Href } from "expo-router";
import { FeatureGatePrompt } from "@/ui/components/subscription/FeatureGatePrompt";
import {
  useFeatureGate,
  computeClientSeatVerdict,
  nextTrainerTierUp,
} from "@/ui/hooks/useFeatureGate";
import { useMySubscription } from "@/ui/hooks/useMySubscription";
import { useGetTrainerClients } from "@/ui/hooks/useGetTrainerClients";
import { useRespondToClientRequest } from "@/ui/hooks/useTrainerInviteCodes";
import { useModeSwitch } from "@/ui/hooks/useModeSwitch";
import { useAddClientSheet } from "@/state/add-client-sheet";
import { color } from "@/ui/theme/tokens";
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
 * Coach Mode Phase 8 (invite/QR): a `clientId` search param (from the
 * redeem-notification deep link `persistencemobile://clients?clientId=…`)
 * defaults the segment to "All" so the just-joined (client-initiated
 * pending) client is visible rather than hidden by the default "Active"
 * filter — no scroll-to, just don't hide it. Accept/decline for those rows
 * is wired to `useRespondToClientRequest`; a successful accept/decline
 * refreshes the roster (mirrors `onInvite`'s refresh-on-success pattern). A
 * 402 at coach-accept (client-seat cap) reuses the SAME no-seats alert copy
 * as the invite-sheet's 402 branch.
 *
 * Spec: specs/10-trainer-features/requirements.md STORY-002;
 *       specs/milestones/M8-coach/CLIENTS_LIST_BRIEF.md (Frontend slice);
 *       specs/milestones/M8-coach/PHASE_8_INVITE_QR_BRIEF.md (Phase 8).
 */
export function ClientsContainer() {
  const subQuery = useMySubscription();
  const gate = useFeatureGate("trainer_clients");
  const roster = useGetTrainerClients();
  const openSheet = useAddClientSheet((s) => s.openSheet);
  const { switchMode } = useModeSwitch();
  const respondToClient = useRespondToClientRequest();

  const { clientId } = useLocalSearchParams<{ clientId?: string }>();
  const [searchQuery, setSearchQuery] = useState("");
  const [segment, setSegment] = useState<ClientSegment>(
    clientId ? "All" : "Active",
  );
  const [pendingActionIds, setPendingActionIds] = useState<Set<string>>(
    new Set(),
  );

  // A deep-linked clientId (from the redeem-notification tap) must surface the
  // just-joined PENDING client — which only shows under the "All" segment. The
  // useState initializer above only fires on first mount; the Clients tab stays
  // mounted, so a tap while already on it updates `clientId` reactively but not
  // the segment. Sync it here so the affordance appears on the common
  // already-mounted path too (Phase 8 — Inspector Brad).
  useEffect(() => {
    if (clientId) setSegment("All");
  }, [clientId]);

  const clients = useMemo(() => roster.data ?? [], [roster.data]);
  const activeCount = useMemo(
    () => clients.filter((c) => c.status === "active").length,
    [clients],
  );

  // Client-slot cap (mirrors the backend trainer_clients gate). Drives the
  // "N of M slots used" line, the disabled invite, and the no-seats warning.
  const subscription = subQuery.data ?? null;
  const seat = useMemo(
    () => computeClientSeatVerdict(subscription, activeCount),
    [subscription, activeCount],
  );

  const refreshRoster = roster.refresh;
  const onInvite = useCallback(() => {
    // Register the roster refresh so a successful invite re-pulls the list.
    openSheet(() => {
      void refreshRoster();
    });
  }, [openSheet, refreshRoster]);

  // "Change subscription" from the at-cap warning → subscription selection,
  // pre-selecting the next trainer tier up when there is one.
  const onUpgrade = useCallback(() => {
    const cycle = subscription?.billingCycle ?? "monthly";
    const target = subscription
      ? nextTrainerTierUp(subscription.tierName)
      : null;
    const query = target ? `?tier=${target}&cycle=${cycle}` : `?cycle=${cycle}`;
    router.push(`/(auth)/subscription-selection${query}` as Href);
  }, [subscription]);

  const onOpenClient = useCallback((id: string) => {
    router.push(`/(app)/clients/${id}`);
  }, []);

  const onSwitchToAthlete = useCallback(() => {
    void switchMode("athlete", "clients");
  }, [switchMode]);

  const respondMutate = respondToClient.mutate;
  const handleRespond = useCallback(
    async (relationshipId: string, action: "accept" | "decline") => {
      setPendingActionIds((prev) => new Set(prev).add(relationshipId));
      const result = await respondMutate(relationshipId, action);
      setPendingActionIds((prev) => {
        const next = new Set(prev);
        next.delete(relationshipId);
        return next;
      });
      if (result.ok) {
        void refreshRoster();
        return;
      }
      // Same client-slot cap backstop + copy as the invite-sheet's 402
      // branch — one underlying cap, one user-facing message. The coach is
      // the actor here (accepting a client-initiated pending), so a 402
      // entitlement denial is the expected shape (mirrors #195/#196).
      if (result.error.code === "entitlement_denied") {
        Alert.alert(
          "No client seats available",
          "Remove a client or change your subscription to invite more.",
        );
        return;
      }
      Alert.alert(
        "Error",
        result.error.message ||
          "Failed to update the request. Please try again.",
      );
    },
    [respondMutate, refreshRoster],
  );
  const onAcceptClient = useCallback(
    (relationshipId: string) => {
      void handleRespond(relationshipId, "accept");
    },
    [handleRespond],
  );
  const onDeclineClient = useCallback(
    (relationshipId: string) => {
      void handleRespond(relationshipId, "decline");
    },
    [handleRespond],
  );

  // Subscription cache not resolved yet — defensive spinner. Once the query
  // lands the gate's `reason: 'unknown'` falls through to a real verdict on
  // the next render.
  if (subQuery.isPending) {
    return (
      <View style={styles.loading} testID="clients-loading">
        <ActivityIndicator size="large" color={color.$primary} />
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
      clientLimit={seat.limit}
      slotsUsed={seat.used}
      atCap={seat.atCap}
      onUpgrade={onUpgrade}
      onAcceptClient={onAcceptClient}
      onDeclineClient={onDeclineClient}
      pendingActionIds={pendingActionIds}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: color.$bg,
  },
  gateWrapper: {
    flex: 1,
    padding: 24,
    justifyContent: "center",
    backgroundColor: color.$bg,
  },
});
