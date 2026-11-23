import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { toneHex } from "@/ui/components/foundation/tones";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconCheck, IconX } from "@/ui/components/icons";

/**
 * <AddToPlanSheetPresenter> — N13's "Add to plan" (PER-133): pick one of your
 * own meal plans and one of its meals, then add the saved meal or recipe to
 * it. Nothing here logs food.
 */

export type AddToPlanChoiceVM = { id: string; name: string };

export type AddToPlanSheetProps = {
  visible: boolean;
  onClose: () => void;
  itemName: string;
  plans: readonly AddToPlanChoiceVM[];
  selectedPlanId: string | null;
  onSelectPlan: (id: string) => void;
  /** Meals of the picked plan. */
  meals: readonly AddToPlanChoiceVM[];
  selectedMealId: string | null;
  onSelectMeal: (id: string) => void;
  /** "Adding to your Training day plan, not today's log", or "". */
  note: string;
  /** "Add to Training day". */
  addLabel: string;
  canAdd: boolean;
  adding: boolean;
  onAdd: () => void;
  testID?: string;
};

const CYAN = "$primary";
const CYAN_HEX = toneHex("primary").base;

function Eyebrow({ children }: { children: string }) {
  return (
    <Text
      fontFamily="$display"
      fontSize={11}
      fontWeight="600"
      letterSpacing={2.6}
      textTransform="uppercase"
      color="$text3"
    >
      {children}
    </Text>
  );
}

function ChoiceRow({
  choice,
  on,
  onPress,
  testID,
}: {
  choice: AddToPlanChoiceVM;
  on: boolean;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: on }}
      testID={testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingVertical={12}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <Text
          flex={1}
          fontFamily="$body"
          fontSize={15}
          fontWeight="500"
          color={on ? CYAN : "$text"}
          numberOfLines={1}
        >
          {choice.name}
        </Text>
        {on ? <IconCheck size={16} color={CYAN_HEX} /> : null}
      </View>
    </Pressable>
  );
}

export function AddToPlanSheetPresenter({
  visible,
  onClose,
  itemName,
  plans,
  selectedPlanId,
  onSelectPlan,
  meals,
  selectedMealId,
  onSelectMeal,
  note,
  addLabel,
  canAdd,
  adding,
  onAdd,
  testID = "add-to-plan-sheet",
}: AddToPlanSheetProps) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      height="tall"
      testID={testID}
      footer={
        plans.length > 0 ? (
          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            disabled={!canAdd || adding}
            onPress={onAdd}
            testID={`${testID}-add`}
          >
            {addLabel}
          </Btn>
        ) : undefined
      }
    >
      <View gap={14}>
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          gap={12}
        >
          <Text
            flex={1}
            fontFamily="$display"
            fontSize={22}
            fontWeight="700"
            color="$text"
            numberOfLines={2}
            accessibilityRole="header"
            testID={`${testID}-title`}
          >
            {`Add ${itemName} to a plan`}
          </Text>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Close"
            testID={`${testID}-close`}
          >
            <View
              width={44}
              height={44}
              borderRadius={9999}
              alignItems="center"
              justifyContent="center"
              backgroundColor="rgba(255,255,255,0.06)"
              borderWidth={1}
              borderColor="$border"
            >
              <IconX size={20} color="#F4F4F8" />
            </View>
          </Pressable>
        </View>

        {plans.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$text3"
            testID={`${testID}-empty`}
          >
            You have no meal plans of your own yet. Make one on the Plan tab.
          </Text>
        ) : (
          <>
            <View>
              <Eyebrow>Plan</Eyebrow>
              {plans.map((p) => (
                <ChoiceRow
                  key={p.id}
                  choice={p}
                  on={p.id === selectedPlanId}
                  onPress={() => onSelectPlan(p.id)}
                  testID={`${testID}-plan-${p.id}`}
                />
              ))}
            </View>
            <View>
              <Eyebrow>Meal</Eyebrow>
              {meals.length === 0 ? (
                <Text
                  fontFamily="$body"
                  fontSize={13}
                  color="$text3"
                  paddingVertical={12}
                  testID={`${testID}-no-meals`}
                >
                  This plan has no meals yet.
                </Text>
              ) : (
                meals.map((m) => (
                  <ChoiceRow
                    key={m.id}
                    choice={m}
                    on={m.id === selectedMealId}
                    onPress={() => onSelectMeal(m.id)}
                    testID={`${testID}-meal-${m.id}`}
                  />
                ))
              )}
            </View>
            {note ? (
              <Text
                fontFamily="$body"
                fontSize={13}
                color="$text3"
                testID={`${testID}-note`}
              >
                {note}
              </Text>
            ) : null}
          </>
        )}
      </View>
    </BottomSheet>
  );
}
