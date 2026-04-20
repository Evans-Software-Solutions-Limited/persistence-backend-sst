import { View, Text as TamaguiText, styled } from "@tamagui/core";
import { FlatList } from "react-native";
import { useMemo } from "react";
import { Column, Input, Text } from "@/ui/components";

/**
 * Pure presenter for a single filter axis (muscles, equipment, difficulty,
 * created-by). Shared across all four axis screens to keep visual parity
 * and ensure the checklist semantics are identical.
 *
 * Layout (ported 1:1 from legacy `persistence-mobile`
 * `components/exercises/FilterDetailScreen`):
 *   - Optional search input at the top (long lists only; `searchable` prop).
 *   - Scrollable checklist below.
 *   - Checklist items show the item's display name + a check icon when
 *     selected. Tap toggles.
 *
 * Selection model: callers decide multi-vs-single select. Presenter is
 * display-only — it just highlights selected items and invokes onToggle.
 */

export type FilterAxisItem = {
  /** Key passed back to onToggle. Any string-coercible domain value works. */
  key: string;
  /** Main label. */
  label: string;
  /** Optional secondary label (e.g. a description or subtitle). */
  sublabel?: string;
};

export type FilterAxisDetailPresenterProps = {
  /** All candidate items to render in the checklist. */
  items: FilterAxisItem[];
  /** Keys currently selected. Order doesn't matter. */
  selectedKeys: string[];
  /** Fires with a key when the user taps a row. */
  onToggle: (key: string) => void;
  /** Whether to render the search bar at the top. Muscles + equipment only. */
  searchable?: boolean;
  /** Placeholder text for the search bar. */
  searchPlaceholder?: string;
  /** Controlled search value. */
  searchValue?: string;
  /** Change handler for the search input. */
  onSearchChange?: (text: string) => void;
  /** testID prefix used for row keys (e.g. "filter-muscles"). */
  testID?: string;
};

const Row = styled(View, {
  flexDirection: "row",
  alignItems: "center",
  justifyContent: "space-between",
  paddingHorizontal: "$base",
  paddingVertical: "$md",
  borderBottomWidth: 1,
  borderBottomColor: "$borderColor",

  pressStyle: {
    backgroundColor: "$surfaceSecondary",
  },
});

const CheckBadge = styled(View, {
  width: 22,
  height: 22,
  borderRadius: 11,
  borderWidth: 2,
  borderColor: "$borderColor",
  alignItems: "center",
  justifyContent: "center",

  variants: {
    selected: {
      true: {
        backgroundColor: "$primary",
        borderColor: "$primary",
      },
    },
  } as const,
});

const CheckMark = styled(TamaguiText, {
  fontSize: 14,
  fontWeight: "700",
  color: "$colorInverse",
  lineHeight: 14,
});

export function FilterAxisDetailPresenter({
  items,
  selectedKeys,
  onToggle,
  searchable,
  searchPlaceholder,
  searchValue,
  onSearchChange,
  testID,
}: FilterAxisDetailPresenterProps) {
  // Local filter — keep case-insensitive + trim so users can paste whole
  // words without precision. We don't score / rank here; legacy UX was a
  // simple contains-filter.
  const visibleItems = useMemo(() => {
    const query = (searchValue ?? "").trim().toLowerCase();
    if (!searchable || query.length === 0) return items;
    return items.filter(
      (item) =>
        item.label.toLowerCase().includes(query) ||
        item.sublabel?.toLowerCase().includes(query),
    );
  }, [items, searchable, searchValue]);

  const selectedSet = useMemo(() => new Set(selectedKeys), [selectedKeys]);

  return (
    <View flex={1} backgroundColor="$background" testID={testID}>
      {searchable && onSearchChange ? (
        <View paddingHorizontal="$base" paddingTop="$sm" paddingBottom="$xs">
          <Input
            placeholder={searchPlaceholder ?? "Search"}
            value={searchValue ?? ""}
            onChangeText={onSearchChange}
            autoCorrect={false}
            autoCapitalize="none"
            testID={`${testID ?? "filter-axis"}-search`}
          />
        </View>
      ) : null}
      {visibleItems.length === 0 ? (
        <Column padding="$lg" gap="sm" centered>
          <Text variant="bodySmall" color="$colorSecondary">
            No matches
          </Text>
        </Column>
      ) : (
        <FlatList
          data={visibleItems}
          keyExtractor={(item) => item.key}
          renderItem={({ item }) => {
            const selected = selectedSet.has(item.key);
            return (
              <Row
                onPress={() => onToggle(item.key)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: selected }}
                accessibilityLabel={item.label}
                testID={`${testID ?? "filter-axis"}-row-${item.key}`}
              >
                <View flex={1}>
                  <Text variant="body">{item.label}</Text>
                  {item.sublabel ? (
                    <Text variant="bodySmall" color="$colorSecondary">
                      {item.sublabel}
                    </Text>
                  ) : null}
                </View>
                <CheckBadge selected={selected}>
                  {selected ? <CheckMark>✓</CheckMark> : null}
                </CheckBadge>
              </Row>
            );
          }}
        />
      )}
    </View>
  );
}
