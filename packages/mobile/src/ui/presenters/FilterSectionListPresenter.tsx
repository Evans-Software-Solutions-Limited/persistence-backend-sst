import { View, styled } from "@tamagui/core";
import { Column, Text } from "@/ui/components";

/**
 * Modal home screen — a section list of filter axes. Each row navigates
 * to the detail screen for that axis, with a subtitle showing the
 * current selection count (or the selected value for single-select axes).
 *
 * Ported from `persistence-mobile` `components/exercises/FilterContainer`.
 * No structural redesign (AC 7.11).
 */

export type FilterSectionRow = {
  key: string;
  label: string;
  subtitle: string;
  onPress: () => void;
};

export type FilterSectionListPresenterProps = {
  rows: FilterSectionRow[];
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

const Chevron = styled(View, {
  width: 10,
  height: 10,
  borderRightWidth: 2,
  borderTopWidth: 2,
  borderColor: "$colorSecondary",
  transform: [{ rotate: "45deg" }],
});

export function FilterSectionListPresenter({
  rows,
}: FilterSectionListPresenterProps) {
  return (
    <View flex={1} backgroundColor="$background" testID="filter-section-list">
      {rows.map((row) => (
        <Row
          key={row.key}
          onPress={row.onPress}
          accessibilityRole="button"
          accessibilityLabel={`${row.label}. ${row.subtitle}`}
          testID={`filter-section-${row.key}`}
        >
          <Column gap="xs" flex={1}>
            <Text variant="body" fontWeight="600">
              {row.label}
            </Text>
            <Text variant="bodySmall" color="$colorSecondary">
              {row.subtitle}
            </Text>
          </Column>
          <Chevron />
        </Row>
      ))}
    </View>
  );
}
