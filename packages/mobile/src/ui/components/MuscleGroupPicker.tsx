import { styled, View, Text as TamaguiText } from "@tamagui/core";
import {
  MUSCLE_GROUPS,
  MUSCLE_GROUP_LABELS,
  type MuscleGroup,
} from "@/domain/models/exercise";

import { Column } from "./Column";
import { Row } from "./Row";
import { Text } from "./Text";

const MuscleChip = styled(View, {
  paddingHorizontal: "$base",
  paddingVertical: "$sm",
  borderRadius: "$md",
  borderWidth: 1,
  borderColor: "$borderColor",
  backgroundColor: "$surfaceSecondary",
  minHeight: 40,
  minWidth: 88,
  alignItems: "center",
  justifyContent: "center",

  pressStyle: {
    opacity: 0.85,
    scale: 0.97,
  },

  variants: {
    active: {
      true: {
        backgroundColor: "$primary",
        borderColor: "$primary",
      },
    },
  } as const,
});

const MuscleChipText = styled(TamaguiText, {
  fontFamily: "$body",
  fontSize: 13,
  lineHeight: 18,
  fontWeight: "600",
  color: "$color",

  variants: {
    active: {
      true: {
        color: "$colorInverse",
      },
    },
  } as const,
});

type MuscleGroupPickerProps = {
  selected: MuscleGroup[];
  onToggle: (group: MuscleGroup) => void;
  testID?: string;
};

export function MuscleGroupPicker({
  selected,
  onToggle,
  testID,
}: MuscleGroupPickerProps) {
  return (
    <Column gap="sm" testID={testID}>
      <Text variant="label" secondary>
        MUSCLE GROUPS
      </Text>
      <Row gap="sm" wrap>
        {MUSCLE_GROUPS.map((group) => {
          const active = selected.includes(group);
          return (
            <MuscleChip
              key={group}
              active={active}
              onPress={() => onToggle(group)}
              accessibilityRole="button"
              accessibilityLabel={`${MUSCLE_GROUP_LABELS[group]} muscle group`}
              accessibilityState={{ selected: active }}
              testID={`muscle-group-${group}`}
            >
              <MuscleChipText active={active}>
                {MUSCLE_GROUP_LABELS[group]}
              </MuscleChipText>
            </MuscleChip>
          );
        })}
      </Row>
    </Column>
  );
}
