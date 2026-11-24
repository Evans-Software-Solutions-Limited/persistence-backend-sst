import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconCheck } from "@/ui/components/icons";

/**
 * <PlansShoppingAddSheetPresenter> — the N23 "+" ("Add a plan"). Not drawn on
 * the canvas: it lists every plan the person has (theirs in cyan, from a
 * coach in violet) with a tick for "in the shopping list". Ticking adds the
 * plan; unticking takes it out (the canvas chips can't be removed).
 *
 * Pure: the container owns the plans and the writes.
 */

export type PlansShoppingPlanRowVM = {
  id: string;
  name: string;
  /** "Yours" or "From <coach>". */
  sub: string;
  fromCoach: boolean;
  included: boolean;
};

export type PlansShoppingAddSheetProps = {
  visible: boolean;
  onClose: () => void;
  plans: readonly PlansShoppingPlanRowVM[];
  onToggle: (planId: string, include: boolean) => void;
  testID?: string;
};

export function PlansShoppingAddSheetPresenter({
  visible,
  onClose,
  plans,
  onToggle,
  testID = "plans-shopping-add",
}: PlansShoppingAddSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Add a plan"
      height="content"
      scrollable={false}
      testID={testID}
    >
      <View gap={14}>
        {plans.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$text3"
            testID={`${testID}-empty`}
          >
            No plans yet. Make one in Plan, or add one your coach sends you.
          </Text>
        ) : (
          <View>
            {plans.map((p) => (
              <Pressable
                key={p.id}
                onPress={() => onToggle(p.id, !p.included)}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: p.included }}
                accessibilityLabel={p.name}
                testID={`${testID}-plan-${p.id}`}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  gap={12}
                  minHeight={56}
                  paddingVertical={8}
                  borderBottomWidth={1}
                  borderColor="$border"
                >
                  <View
                    width={24}
                    height={24}
                    borderRadius={7}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={p.included ? "$primary" : "transparent"}
                    borderWidth={p.included ? 0 : 1.5}
                    borderColor="$text4"
                  >
                    {p.included ? (
                      <IconCheck size={14} strokeWidth={3} color="#042F39" />
                    ) : null}
                  </View>
                  <View flex={1} gap={2}>
                    <Text
                      fontFamily="$body"
                      fontSize={15}
                      fontWeight="500"
                      color="$text"
                      numberOfLines={1}
                    >
                      {p.name}
                    </Text>
                    <Text
                      fontFamily="$body"
                      fontSize={12}
                      color={p.fromCoach ? "$accentTrainer" : "$primary"}
                      numberOfLines={1}
                    >
                      {p.sub}
                    </Text>
                  </View>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onClose}
          testID={`${testID}-done`}
        >
          Done
        </Btn>
      </View>
    </BottomSheet>
  );
}
