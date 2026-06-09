import { Text, View } from "@tamagui/core";
import { useCallback } from "react";
import { FlatList, RefreshControl } from "react-native";
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
 * Grouped date sections + rows in a single FlatList, pull-to-refresh,
 * cursor pagination, empty state, mark-all-read.
 *
 * FlatList (not FlashList) per the Revised 2026-06-07 decision — FlashList
 * is deferred to M11; the data/renderItem/refresh/onEndReached contract is
 * identical so the swap is mechanical.
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
  const isEmpty = data.length === 0;

  const renderItem = useCallback(
    ({ item }: { item: ListItem }) =>
      item.kind === "section" ? (
        <View paddingHorizontal={16} paddingTop={16} paddingBottom={4}>
          <Section eyebrow={item.label} />
        </View>
      ) : (
        <NotificationRowPresenter
          notification={item.notification}
          onPress={() => onTap(item.notification)}
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

      <FlatList
        testID="notifications-list"
        data={data}
        keyExtractor={keyExtractor}
        renderItem={renderItem}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={color.$text3}
          />
        }
        onEndReached={onLoadMore}
        onEndReachedThreshold={0.5}
        contentContainerStyle={
          isEmpty ? { flexGrow: 1 } : { paddingBottom: insets.bottom + 24 }
        }
        ListEmptyComponent={
          isLoading ? null : (
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
          )
        }
      />
    </View>
  );
}
