import React from "react";
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { SyncQueueEntry } from "@/domain/ports/storage.port";
import {
  BorderRadius,
  Colors,
  Shadows,
  Spacing,
} from "@/ui/theme/subscriptionLegacyTheme";

/**
 * Failed-sync review screen — pure presenter.
 *
 * Spec: specs/milestones/M13-sync-hardening § Failed-sync review UI
 *
 * Mirrors `SyncBlockedPresenter` (M10.6) — same card/list/empty-state
 * shape — but WITHOUT the upgrade-target grouping: failed-exhausted
 * entries have no verdict to group by, so this renders one card per
 * entry with its own Retry / Discard pair.
 *
 * Renders per entry:
 *   - entityType + relative created date + the last error message (the
 *     concrete reason this entry stopped retrying — useful for a user
 *     deciding whether this looks like a transient blip or something
 *     worth reporting).
 *   - "Retry" → `onRetry(entry)` — the container resets just this
 *     entry's retry budget then triggers a flush.
 *   - "Discard" → `onDiscard(entry)` — the container wraps this in a
 *     confirmation Alert (with an extra-severe warning when the entry is
 *     a completed session, since discarding it loses that workout
 *     locally/forever — there is no server copy to fall back on).
 *
 * Empty state: friendly "all clear" copy — happens after the user
 * resolves the last failed entry (retry lands, or they discard it), or
 * connectivity returns and `useSyncWorker`'s reconnect resurrect quietly
 * drains it before the user ever opens this screen.
 */
export interface SyncFailedPresenterProps {
  entries: SyncQueueEntry[];
  onRetry: (entry: SyncQueueEntry) => void;
  onDiscard: (entry: SyncQueueEntry) => void;
}

function describeEntry(entry: SyncQueueEntry): string {
  // Brief: "Workout #1 from 2026-05-23". Mirrors SyncBlockedPresenter's
  // describeEntry — entityType + createdAt, since entityId can be a local
  // UUID that's meaningless to the user.
  const createdDate = entry.createdAt.slice(0, 10);
  return `${entry.entityType} from ${createdDate}`;
}

export function SyncFailedPresenter({
  entries,
  onRetry,
  onDiscard,
}: SyncFailedPresenterProps) {
  if (entries.length === 0) {
    return (
      <View style={styles.emptyContainer} testID="sync-failed-empty">
        <Ionicons
          name="checkmark-circle-outline"
          size={48}
          color={Colors.success.DEFAULT}
        />
        <Text style={styles.emptyTitle}>All clear</Text>
        <Text style={styles.emptyBody}>
          Nothing is currently stuck — everything has synced.
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      contentContainerStyle={styles.scrollContent}
      testID="sync-failed-list"
    >
      {entries.map((entry) => (
        <View
          key={entry.id}
          style={styles.card}
          testID={`sync-failed-entry-${entry.id}`}
        >
          <View style={styles.cardHeader}>
            <Ionicons
              name="alert-circle-outline"
              size={16}
              color={Colors.error.DEFAULT}
            />
            <Text style={styles.cardTitle} numberOfLines={2}>
              {describeEntry(entry)}
            </Text>
          </View>

          {entry.errorMessage && (
            <Text style={styles.errorLine} numberOfLines={2}>
              {entry.errorMessage}
            </Text>
          )}

          <View style={styles.ctaRow}>
            <TouchableOpacity
              style={styles.primaryButton}
              onPress={() => onRetry(entry)}
              activeOpacity={0.7}
              testID={`sync-failed-retry-${entry.id}`}
            >
              <Text style={styles.primaryButtonText}>Retry</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.secondaryButton}
              onPress={() => onDiscard(entry)}
              activeOpacity={0.7}
              testID={`sync-failed-discard-${entry.id}`}
            >
              <Text style={styles.secondaryButtonText}>Discard</Text>
            </TouchableOpacity>
          </View>
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scrollContent: {
    padding: Spacing.md,
    gap: Spacing.md,
  },
  card: {
    backgroundColor: Colors.surface.primary,
    borderRadius: BorderRadius.lg,
    padding: Spacing.lg,
    ...Shadows.medium,
    gap: Spacing.sm,
  },
  cardHeader: {
    flexDirection: "row",
    alignItems: "center",
    gap: Spacing.xs,
  },
  cardTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  errorLine: {
    fontSize: 13,
    color: Colors.text.secondary,
  },
  ctaRow: {
    flexDirection: "row",
    gap: Spacing.sm,
    marginTop: Spacing.sm,
  },
  primaryButton: {
    flex: 1,
    backgroundColor: Colors.primary.DEFAULT,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: "600",
    color: Colors.text.inverse,
  },
  secondaryButton: {
    flex: 1,
    paddingVertical: Spacing.sm + 2,
    paddingHorizontal: Spacing.md,
    borderRadius: BorderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: Colors.surface.border,
  },
  secondaryButtonText: {
    fontSize: 14,
    fontWeight: "600",
    color: Colors.text.tertiary,
  },
  emptyContainer: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: Spacing.xl,
    gap: Spacing.sm,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: Colors.text.primary,
  },
  emptyBody: {
    fontSize: 14,
    color: Colors.text.secondary,
    textAlign: "center",
  },
});
