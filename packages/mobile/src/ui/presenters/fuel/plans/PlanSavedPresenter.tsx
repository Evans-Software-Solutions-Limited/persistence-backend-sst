import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn } from "@/ui/components/foundation";
import { IconBasket, IconCalendar } from "@/ui/components/icons";
import { CloseBtn, PlanTopBar } from "./PlanChrome";

/**
 * <PlanSavedPresenter> — canvas N33 "Saved" (PER-133): "Saved to your
 * plans", the name, Meals · kcal · Protein, then View in Plan and Add to
 * shopping list. Plans have no days, so the canvas's "Use on" day chips,
 * the "Runs on …" note and "Pick the days it runs…" are left out.
 *
 * Pure.
 */

export type PlanSavedProps = {
  name: string;
  mealCount: number;
  kcal: number;
  proteinG: number;
  onClose: () => void;
  onViewInPlan: () => void;
  onShoppingList: () => void;
  addingToList: boolean;
  testID?: string;
};

const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

function Cell({
  value,
  label,
  colour = "$text",
  first = false,
}: {
  value: string;
  label: string;
  colour?: string;
  first?: boolean;
}) {
  return (
    <View
      flex={1}
      gap={2}
      paddingLeft={first ? 0 : 12}
      borderLeftWidth={first ? 0 : 1}
      borderColor="$border"
    >
      <Text fontFamily="$mono" fontSize={16} fontWeight="700" color={colour}>
        {value}
      </Text>
      <Text
        fontFamily="$display"
        fontSize={10}
        fontWeight="600"
        letterSpacing={1.6}
        textTransform="uppercase"
        color="$text3"
      >
        {label}
      </Text>
    </View>
  );
}

export function PlanSavedPresenter({
  name,
  mealCount,
  kcal,
  proteinG,
  onClose,
  onViewInPlan,
  onShoppingList,
  addingToList,
  testID = "plan-saved",
}: PlanSavedProps) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <PlanTopBar
        left={null}
        eyebrow="New plan"
        right={<CloseBtn onPress={onClose} testID={`${testID}-close`} />}
      />
      <View flex={1} paddingHorizontal={20}>
        <View
          marginTop={40}
          alignSelf="center"
          width={88}
          height={88}
          borderRadius={9999}
          alignItems="center"
          justifyContent="center"
          backgroundColor="$primaryDim"
        >
          <IconCalendar size={38} color="#22D3EE" />
        </View>
        <Text
          marginTop={24}
          textAlign="center"
          fontFamily="$display"
          fontSize={30}
          lineHeight={36}
          fontWeight="800"
          letterSpacing={-0.8}
          color="$text"
          accessibilityRole="header"
        >
          Saved to your plans
        </Text>
        <Text
          marginTop={8}
          textAlign="center"
          fontFamily="$body"
          fontSize={14}
          color="$text2"
        >
          Under Mine in Plan.
        </Text>
        <View
          marginTop={22}
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
          paddingVertical={10}
          borderBottomWidth={1}
          borderColor="$border"
        >
          <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
            Name
          </Text>
          <View
            height={40}
            minWidth={200}
            paddingHorizontal={14}
            borderRadius={12}
            backgroundColor="$surface2"
            borderWidth={1}
            borderColor="rgba(255,255,255,0.08)"
            justifyContent="center"
          >
            <Text
              fontFamily="$body"
              fontSize={15}
              fontWeight="600"
              color="$text"
              numberOfLines={1}
              testID={`${testID}-name`}
            >
              {name}
            </Text>
          </View>
        </View>
        <View
          marginTop={20}
          flexDirection="row"
          borderTopWidth={1}
          borderBottomWidth={1}
          borderColor="$border2"
          paddingVertical={10}
        >
          <Cell value={String(mealCount)} label="Meals" first />
          <Cell value={fmt(kcal)} label="kcal" />
          <Cell value={`${fmt(proteinG)}g`} label="Protein" colour="$success" />
        </View>
      </View>
      <View paddingHorizontal={20} paddingBottom={insets.bottom + 16} gap={10}>
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onViewInPlan}
          testID={`${testID}-view`}
        >
          View in Plan
        </Btn>
        <Btn
          variant="outline"
          tone="primary"
          size="lg"
          full
          icon={<IconBasket size={16} color="#F4F4F8" />}
          disabled={addingToList}
          onPress={onShoppingList}
          testID={`${testID}-shopping`}
        >
          Add to shopping list
        </Btn>
      </View>
    </View>
  );
}
