import { useMemo, useState } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Card } from "@/ui/components/foundation";
import { HeaderBar } from "@/ui/components/foundation/HeaderBar";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { Segmented } from "@/ui/components/foundation/Segmented";
import { SearchBar } from "@/ui/components/composite/SearchBar";
import { SummaryChip } from "@/ui/components/composite/SummaryChip";
import {
  IconInfo,
  IconPlus,
  IconUsers,
  iconDefaults,
} from "@/ui/components/icons";
import { ErrorState, PLogoDrawLoader } from "@/ui/components";
import type { ApiError } from "@/shared/errors";
import type { TrainerClient } from "@/domain/models/trainerClient";
import { AdherenceLegend } from "./AdherenceLegend";
import { ClientRow } from "./ClientRow";

/**
 * <ClientsListPresenter> — the coach Clients tab roster.
 * Ports the prototype's `ClientsScreenV2` (design-source/screens/coach.jsx:
 * 393-458) 1:1: large HeaderBar ("Clients", COACHING eyebrow, trainer-tone "+")
 * → three summary chips (Need attention / New PR / Programme ends) → SearchBar →
 * trainer-accent Segmented (Active | All | Archive) → "SORTED BY · ADHERENCE"
 * header with an info toggle that expands <AdherenceLegend> → the rows in a
 * single `Card pad={0}`.
 *
 * Pure presentational; cache-first (renders whatever roster data is present,
 * blocking loader/error only when there's nothing at all). Search + segment
 * are controlled by the container; the legend toggle is local view state.
 *
 * The roster arrives pre-sorted by adherence ascending (null last) from the
 * backend; this presenter never re-sorts — it only filters by status (segment)
 * and name (search). Rows render inside one Card mapped directly (per the
 * prototype) rather than a virtualized list: the roster is bounded by the
 * trainer's client-slot limit, and FlashList is deferred to M11.
 */

export type ClientSegment = "Active" | "All" | "Archive";

export type ClientsListPresenterProps = {
  clients: TrainerClient[];
  /** Count of active-status clients (drives the eyebrow). */
  activeCount: number;
  searchQuery: string;
  onSearchChange: (next: string) => void;
  segment: ClientSegment;
  onSegmentChange: (next: ClientSegment) => void;
  isLoading: boolean;
  isRefreshing: boolean;
  error?: ApiError | null;
  onRefresh: () => void;
  onInvite: () => void;
  onOpenClient: (id: string) => void;
  /**
   * Strand-guard escape: switch back to athlete mode. The roster 403s for a
   * non-trainer who reached coach mode, and the error state is otherwise a
   * dead end (Retry just re-403s) — this offers the way out.
   */
  onSwitchToAthlete: () => void;
  /**
   * Client-slot cap context (mirrors the backend `trainer_clients` gate).
   * `clientLimit` null = unlimited/unknown (no "N of M" line). When `atCap`,
   * the invite affordance is disabled and the no-seats warning renders;
   * `onUpgrade` routes to subscription selection.
   */
  clientLimit?: number | null;
  slotsUsed?: number;
  atCap?: boolean;
  onUpgrade?: () => void;
  /**
   * Accept/decline a client-initiated pending row (Coach Mode Phase 8 —
   * invite/QR). Omit both to render the roster with no accept/decline
   * affordance regardless of any row's status/initiatedBy.
   */
  onAcceptClient?: (relationshipId: string) => void;
  onDeclineClient?: (relationshipId: string) => void;
  /** relationshipIds with an in-flight accept/decline call (per-row busy UI). */
  pendingActionIds?: ReadonlySet<string>;
  /** Injected clock for deterministic relative-time tests. */
  now?: number;
  testID?: string;
};

/** Filter the roster by segment status then case-insensitive name match. */
export function filterClients(
  clients: TrainerClient[],
  segment: ClientSegment,
  query: string,
): TrainerClient[] {
  const q = query.trim().toLowerCase();
  return clients.filter((c) => {
    // Active → active only. All → active + pending. Archive → none (no archived
    // status reaches the roster in v1) → an empty state.
    if (segment === "Active" && c.status !== "active") return false;
    if (segment === "Archive") return false;
    if (q && !c.name.toLowerCase().includes(q)) return false;
    return true;
  });
}

/** Count of clients needing attention: at-risk/crisis band OR a MISSED flag. */
export function needsAttentionCount(clients: TrainerClient[]): number {
  return clients.filter(
    (c) =>
      c.band === "atRisk" ||
      c.band === "crisis" ||
      c.flags.some((f) => /missed/i.test(f.label)),
  ).length;
}

/** Count of clients with a NEW PR flag. */
export function newPrCount(clients: TrainerClient[]): number {
  return clients.filter((c) => c.flags.some((f) => /new pr/i.test(f.label)))
    .length;
}

function EmptyState({
  title,
  body,
  testID,
}: {
  title: string;
  body: string;
  testID: string;
}) {
  return (
    <Card pad={24} radius={14} testID={testID} style={{ alignItems: "center" }}>
      <View
        width={56}
        height={56}
        borderRadius={9999}
        backgroundColor="$accentTrainerDim"
        alignItems="center"
        justifyContent="center"
        marginBottom={12}
      >
        <IconUsers {...iconDefaults({ size: 24 })} color="#A78BFA" />
      </View>
      <Text
        fontFamily="$display"
        fontWeight="700"
        fontSize={16}
        color="$text"
        marginBottom={4}
        textAlign="center"
      >
        {title}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={13}
        color="$text3"
        textAlign="center"
        lineHeight={18}
      >
        {body}
      </Text>
    </Card>
  );
}

export function ClientsListPresenter(props: ClientsListPresenterProps) {
  const {
    clients,
    activeCount,
    searchQuery,
    onSearchChange,
    segment,
    onSegmentChange,
    isLoading,
    isRefreshing,
    error,
    onRefresh,
    onInvite,
    onOpenClient,
    onSwitchToAthlete,
    clientLimit,
    slotsUsed,
    atCap = false,
    onUpgrade,
    onAcceptClient,
    onDeclineClient,
    pendingActionIds,
    now = Date.now(),
    testID,
  } = props;

  // "N of M slots used" only renders for a finite cap (a numeric limit).
  const showSlots =
    typeof clientLimit === "number" && typeof slotsUsed === "number";

  const insets = useSafeAreaInsets();
  const [showLegend, setShowLegend] = useState(false);

  const filtered = useMemo(
    () => filterClients(clients, segment, searchQuery),
    [clients, segment, searchQuery],
  );

  // Summary counts are computed over the WHOLE roster, not the filtered view —
  // they're a fixed at-a-glance triage, independent of the search/segment.
  const attention = useMemo(() => needsAttentionCount(clients), [clients]);
  const prs = useMemo(() => newPrCount(clients), [clients]);

  if (isLoading && clients.length === 0) {
    return (
      <View
        flex={1}
        alignItems="center"
        justifyContent="center"
        testID="clients-loader"
      >
        <PLogoDrawLoader />
      </View>
    );
  }
  if (error && clients.length === 0) {
    return (
      <View flex={1} testID="clients-error-state">
        <ErrorState
          message="Couldn't load your clients."
          onRetry={onRefresh}
          secondaryLabel="Switch to athlete mode"
          onSecondary={onSwitchToAthlete}
        />
      </View>
    );
  }

  const hasAnyClients = clients.length > 0;

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      <ScrollView
        testID="clients-scroll"
        contentContainerStyle={{ paddingBottom: 140 }}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >
        <HeaderBar
          large
          title="Clients"
          eyebrow={`COACHING · ${activeCount} ACTIVE`}
          trailing={
            <IconBtn
              icon={<IconPlus size={18} strokeWidth={2.2} />}
              tone="trainer"
              onPress={onInvite}
              disabled={atCap}
              accessibilityLabel="Invite client"
              testID="clients-invite-btn"
            />
          }
        />

        <View paddingHorizontal={16} gap={14}>
          {/* Client-slot usage + no-seats warning. */}
          {showSlots ? (
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              testID="clients-slots-used"
            >
              {`${slotsUsed} of ${clientLimit} client slots used`}
            </Text>
          ) : null}

          {atCap ? (
            <Card
              pad={16}
              radius={14}
              testID="clients-no-seats-warning"
              style={{ gap: 6 }}
            >
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={14}
                color="$text"
              >
                No client seats available
              </Text>
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text3"
                lineHeight={18}
              >
                Remove a client or change your subscription to invite more.
              </Text>
              {onUpgrade ? (
                <Pressable
                  onPress={onUpgrade}
                  accessibilityRole="button"
                  accessibilityLabel="Change subscription"
                  testID="clients-no-seats-upgrade"
                  style={({ pressed }) => ({
                    opacity: pressed ? 0.7 : 1,
                    marginTop: 4,
                  })}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={13}
                    color="#A78BFA"
                  >
                    Change subscription
                  </Text>
                </Pressable>
              ) : null}
            </Card>
          ) : null}

          {/* Summary chips. */}
          <View flexDirection="row" gap={8}>
            <SummaryChip
              count={attention}
              label="Need attention"
              tone="ember"
              testID="clients-summary-attention"
            />
            <SummaryChip
              count={prs}
              label="New PR"
              tone="gold"
              testID="clients-summary-prs"
            />
            {/* "Programme ends" is 0 in v1 (no program_assignments yet) — the
                chip stays per the prototype, the count is honest. */}
            <SummaryChip
              count={0}
              label="Programme ends"
              tone="trainer"
              testID="clients-summary-programme"
            />
          </View>

          {/* Search. */}
          <SearchBar
            placeholder="Search clients"
            value={searchQuery}
            onChangeText={onSearchChange}
            testID="clients-search"
          />

          {/* Segmented status filter. */}
          <Segmented
            options={["Active", "All", "Archive"]}
            value={segment}
            onChange={(v) => onSegmentChange(v as ClientSegment)}
            accent="trainer"
            testID="clients-segmented"
          />

          {/* Adherence header + explain toggle. */}
          <View
            flexDirection="row"
            alignItems="center"
            justifyContent="space-between"
          >
            <Text
              fontFamily="$display"
              fontSize={10.5}
              fontWeight="600"
              letterSpacing={1.7}
              textTransform="uppercase"
              color="$text3"
            >
              Sorted by · Adherence
            </Text>
            <Pressable
              onPress={() => setShowLegend((v) => !v)}
              accessibilityRole="button"
              accessibilityLabel="What is adherence?"
              accessibilityState={{ expanded: showLegend }}
              testID="clients-legend-toggle"
              style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={4}
                paddingVertical={4}
                paddingHorizontal={8}
                borderRadius={6}
                minHeight={28}
              >
                <IconInfo size={12} color="#8A8A98" />
                <Text fontFamily="$body" fontSize={11.5} color="$text3">
                  What is adherence?
                </Text>
              </View>
            </Pressable>
          </View>

          {showLegend ? (
            <AdherenceLegend
              onClose={() => setShowLegend(false)}
              testID="clients-legend"
            />
          ) : null}

          {/* Client list. */}
          {!hasAnyClients ? (
            <EmptyState
              title="No clients yet"
              body="Invite your first client with the + button to start coaching."
              testID="clients-empty"
            />
          ) : filtered.length === 0 ? (
            <EmptyState
              title="Nothing here"
              body={
                segment === "Archive"
                  ? "Archived clients will show up here."
                  : "No clients match those filters."
              }
              testID="clients-empty-filtered"
            />
          ) : (
            <Card pad={0} radius={14} testID="clients-card">
              {filtered.map((client, i) => (
                <ClientRow
                  key={client.id}
                  client={client}
                  isLast={i === filtered.length - 1}
                  onPress={onOpenClient}
                  now={now}
                  testID={`client-row-${client.id}`}
                  onAccept={onAcceptClient}
                  onDecline={onDeclineClient}
                  busy={
                    client.relationshipId != null &&
                    (pendingActionIds?.has(client.relationshipId) ?? false)
                  }
                />
              ))}
            </Card>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
