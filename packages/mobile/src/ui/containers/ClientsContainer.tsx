import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { ActivityIndicator, Alert, StyleSheet, View } from "react-native";
import {
  router,
  useFocusEffect,
  useLocalSearchParams,
  type Href,
} from "expo-router";
import { FeatureGatePrompt } from "@/ui/components/subscription/FeatureGatePrompt";
import {
  useFeatureGate,
  computeClientSeatVerdict,
  nextTrainerTierUp,
} from "@/ui/hooks/useFeatureGate";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
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
  const { storage } = useAdapters();
  const { session } = useAuth();
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

  const refreshRoster = roster.refresh;

  // A deep-linked clientId (from the redeem-notification tap) must surface the
  // just-joined PENDING client — which only shows under the "All" segment. The
  // useState initializer above only fires on first mount; the Clients tab stays
  // mounted, so a tap while already on it updates `clientId` reactively but not
  // the segment. Sync it here so the affordance appears on the common
  // already-mounted path too (Phase 8 — Inspector Brad).
  //
  // Also refresh the roster here (QA-14b): a client who joined by code
  // arrives at this deep link via a push notification while the Clients tab
  // may already be mounted underneath — without a refresh here the new
  // pending row wouldn't appear until the next focus or a manual pull, i.e.
  // the user would need to restart/re-navigate to see the client they just
  // tapped through to see.
  useEffect(() => {
    if (!clientId) return;
    setSegment("All");
    void refreshRoster();
  }, [clientId, refreshRoster]);

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

  // Re-fetch on refocus (spec 25 coach↔client offboarding AC-1.3) — a client
  // removed from Client Detail invalidates the roster cache and navigates
  // back here; this screen stays mounted underneath (expo-router keeps the
  // previous stack entry alive), so without a focus-driven refresh the
  // removed row and stale seat count would otherwise linger until the 5-
  // minute staleness window lapses. Skip the FIRST focus — it coincides with
  // the hook's own mount-time fetch — mirrors ClientDetailContainer.
  const firstFocus = useRef(true);
  useFocusEffect(
    useCallback(() => {
      if (firstFocus.current) {
        firstFocus.current = false;
        return;
      }
      void refreshRoster();
    }, [refreshRoster]),
  );

  const userId = session?.userId ?? null;

  // Invalidate the roster's SQLite slot before re-fetching (QA-14b): the
  // cache-first `useCachedResource` read otherwise happily serves the
  // stale-but-not-yet-expired roster back while the refresh is in flight
  // (and if the refresh silently no-ops for any reason, the stale cache
  // would linger even longer). Forcing the slot stale means the re-read
  // that follows can't paper over a failed refresh.
  const invalidateAndRefresh = useCallback(() => {
    if (userId) storage.invalidateTrainerClients(userId);
    void refreshRoster();
  }, [storage, userId, refreshRoster]);

  const onInvite = useCallback(() => {
    // Register the roster refresh so a successful invite re-pulls the list.
    openSheet(() => {
      invalidateAndRefresh();
    });
  }, [openSheet, invalidateAndRefresh]);

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
        // `respondToClientRelationship` is a direct-online call (no sync
        // queue involvement) — the mutation has already resolved on the
        // server by the time we get here, so invalidate-then-refresh runs
        // strictly after it, in order.
        invalidateAndRefresh();
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
    [respondMutate, invalidateAndRefresh],
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
