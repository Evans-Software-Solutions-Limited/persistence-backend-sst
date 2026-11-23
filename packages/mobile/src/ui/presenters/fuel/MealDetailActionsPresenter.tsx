import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import { IconPlus } from "@/ui/components/icons";

/**
 * <MealDetailActionsPresenter> — N13's two buttons (PER-133): "Add to plan"
 * (outline) next to "Log meal", shared by the saved-meal and recipe pages.
 */

export type MealDetailActionsProps = {
  onAddToPlan: () => void;
  onLog: () => void;
  testID: string;
};

export function MealDetailActionsPresenter({
  onAddToPlan,
  onLog,
  testID,
}: MealDetailActionsProps) {
  return (
    <View flexDirection="row" gap={10}>
      <Pressable
        style={{ flex: 1 }}
        onPress={onAddToPlan}
        accessibilityRole="button"
        testID={`${testID}-add-to-plan`}
      >
        <View
          height={52}
          borderRadius={14}
          borderWidth={1}
          borderColor="rgba(255,255,255,0.16)"
          alignItems="center"
          justifyContent="center"
        >
          <Text fontFamily="$body" fontSize={15} fontWeight="600" color="$text">
            Add to plan
          </Text>
        </View>
      </Pressable>
      <View flex={1.3}>
        <Btn
          full
          variant="filled"
          tone="primary"
          size="lg"
          icon={<IconPlus size={16} />}
          onPress={onLog}
          testID={`${testID}-log`}
        >
          Log meal
        </Btn>
      </View>
    </View>
  );
}
