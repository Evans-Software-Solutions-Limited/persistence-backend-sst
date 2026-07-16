import { Text, View } from "@tamagui/core";
import { useCallback } from "react";
import { RefreshControl, ScrollView } from "react-native";
import { FlashList } from "@shopify/flash-list";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { Notification } from "@/domain/models/notification";
import type { NotificationGroup } from "@/application/notifications/grouping";
import { HeaderBar } from "@/ui/components/foundation/HeaderBar";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { Section } from "@/ui/components/composite/Section";
import { IconBack, IconCheck } from "@/ui/components/icons";
import { NotificationRowPresenter } from "@/ui/components/notifications/NotificationRow";
import { color } from "@/ui/theme/tokens";

/**
 * <NotificationsListPresenter> — pure presenter for the notifications list.
 * Grouped date sections + rows in a single FlashList, pull-to-refresh,
 * cursor pagination, empty state, mark-all-read.
 *
 * FlashList (spec-12.5): the earlier 2026-06-07 "keep FlatList" note deferred
 * the swap to M11 — 12.5 IS that slot. The list is paginated (onEndReached) and
 * routinely exceeds 20 rows, so it qualifies under the >=20-row rule. Section
 * headers and rows are heterogeneous, so `getItemType` keeps FlashList's
 * recycling pools separate.
 *
 * Spec: specs/09-notifications-social/design.md § NotificationsListPresenter
 *       requirements.md STORY-002
 */

export type NotificationsListProps = {
  groups: NotificationGroup[];
  unreadCount: number;
  /** True while a refresh / first load is in flight (drives RefreshControl). */
  isRefreshing: boolean;
  /** True before the first cache read resolves (shows nothing vs. empty). */
  isLoading: boolean;
  error: Error | null;
  onTap: (notification: Notification) => void;
  onMarkAllRead: () => void;
  onRefresh: () => void;
  onLoadMore: () => void;
  onBack: () => void;
  /** Injected clock for deterministic relative-time rendering in tests. */
  now?: number;
};

type ListItem =
  | { kind: "section"; label: string }
  | { kind: "row"; notification: Notification };

/** Flatten grouped notifications into a single FlatList data array. */
export function flattenGroups(groups: NotificationGroup[]): ListItem[] {
  const items: ListItem[] = [];
  for (const group of groups) {
    items.push({ kind: "section", label: group.label });
    for (const notification of group.notifications) {
      items.push({ kind: "row", notification });
    }
  }
  return items;
}

function keyExtractor(item: ListItem): string {
  return item.kind === "section"
    ? `section:${item.label}`
    : `row:${item.notification.id}`;
}

export function NotificationsListPresenter({
  groups,
  unreadCount,
  isRefreshing,
  isLoading,
  error,
  onTap,
  onMarkAllRead,
  onRefresh,
  onLoadMore,
  onBack,
  now,
}: NotificationsListProps) {
  const insets = useSafeAreaInsets();
  const data = flattenGroups(groups);

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) =>
      item.kind === "section" ? (
        <View paddingHorizontal={16} paddingTop={16} paddingBottom={4}>
          <Section eyebrow={item.label} />
        </View>
      ) : (
        <NotificationRowPresenter
          notification={item.notification}
          onPress={onTap}
          now={now}
        />
      ),
    [onTap, now],
  );

  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <HeaderBar
        large
        title="Notifications"
        eyebrow={`${unreadCount} UNREAD`}
        leading={
          <IconBtn
            icon={<IconBack size={18} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
        trailing={
          unreadCount > 0 ? (
            <IconBtn
              icon={<IconCheck size={18} />}
              tone="ghost"
              onPress={onMarkAllRead}
              accessibilityLabel="Mark all read"
            />
          ) : undefined
        }
      />

      {data.length === 0 ? (
        // Empty state: FlashList v2 won't honour `flexGrow` in
        // contentContainerStyle, so it can't centre an empty child. Fall back
        // to a ScrollView (flexGrow:1) to keep the centred empty state AND
        // pull-to-refresh, matching the legacy FlatList layout.
        <ScrollView
          testID="notifications-list"
          contentContainerStyle={{ flexGrow: 1 }}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={color.$text3}
            />
          }
        >
          {isLoading ? null : (
            <View
              flex={1}
              alignItems="center"
              justifyContent="center"
              paddingHorizontal={32}
              gap={8}
              testID="notifications-empty"
            >
              <Text
                fontFamily="$display"
                fontWeight="700"
                fontSize={18}
                color="$text"
              >
                No notifications yet
              </Text>
              <Text
                fontFamily="$body"
                fontSize={14}
                color="$text2"
                textAlign="center"
              >
                {error
                  ? "Couldn't refresh — showing what we have."
                  : "Check back after a workout 💪"}
              </Text>
            </View>
          )}
        </ScrollView>
      ) : (
        <FlashList
          testID="notifications-list"
          data={data}
          keyExtractor={keyExtractor}
          renderItem={renderItem}
          getItemType={(item) => item.kind}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={onRefresh}
              tintColor={color.$text3}
            />
          }
          onEndReached={onLoadMore}
          onEndReachedThreshold={0.5}
          contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
        />
      )}
    </View>
  );
}
