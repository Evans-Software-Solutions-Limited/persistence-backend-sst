import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";

/**
 * <MealOptionsSheetPresenter> — a meal's ⋯ menu (canvas N1, PER-132): Copy
 * from earlier days · Save as a meal · Edit your meals · Clear <meal>.
 */

export type MealOptionsSheetProps = {
  visible: boolean;
  onClose: () => void;
  mealName: string;
  /** False when the meal has nothing logged: Save and Clear are hidden. */
  hasEntries: boolean;
  onCopy: () => void;
  onSaveAsMeal: () => void;
  onEditMeals: () => void;
  onClear: () => void;
  testID?: string;
};

function Option({
  title,
  sub,
  onPress,
  destructive = false,
  testID,
}: {
  title: string;
  sub?: string;
  onPress: () => void;
  destructive?: boolean;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        paddingVertical={12}
        borderBottomWidth={1}
        borderColor="$border"
        gap={2}
      >
        <Text
          fontFamily="$body"
          fontSize={15}
          fontWeight="500"
          color={destructive ? "$error" : "$text"}
        >
          {title}
        </Text>
        {sub ? (
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {sub}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export function MealOptionsSheetPresenter({
  visible,
  onClose,
  mealName,
  hasEntries,
  onCopy,
  onSaveAsMeal,
  onEditMeals,
  onClear,
  testID = "meal-options-sheet",
}: MealOptionsSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title={mealName}
      height="content"
      testID={testID}
    >
      <View>
        <Option
          title="Copy from earlier days"
          sub="Recent meals, saved meals, recipes"
          onPress={onCopy}
          testID={`${testID}-copy`}
        />
        {hasEntries ? (
          <Option
            title="Save as a meal"
            sub="Log it again in one tap"
            onPress={onSaveAsMeal}
            testID={`${testID}-save`}
          />
        ) : null}
        <Option
          title="Edit your meals"
          sub="Rename, add or reorder meals"
          onPress={onEditMeals}
          testID={`${testID}-edit`}
        />
        {hasEntries ? (
          <Option
            title={`Clear ${mealName}`}
            onPress={onClear}
            destructive
            testID={`${testID}-clear`}
          />
        ) : null}
        <View marginTop={14}>
          <Btn
            variant="outline"
            tone="primary"
            size="lg"
            full
            onPress={onClose}
            testID={`${testID}-cancel`}
          >
            Cancel
          </Btn>
        </View>
      </View>
    </BottomSheet>
  );
}
