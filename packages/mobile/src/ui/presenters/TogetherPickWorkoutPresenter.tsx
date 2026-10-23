import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card } from "@/ui/components/foundation";
import { TogetherBackButton } from "./TogetherBackButton";
import { TogetherBtn } from "./TogetherBtn";
import { TogetherEyebrow } from "./TogetherEyebrow";

export interface TogetherWorkoutOption {
  id: string;
  name: string;
  /** "3 exercises · about 50 min" */
  meta: string;
}

function Radio({ on }: { on: boolean }) {
  return (
    <View
      width={18}
      height={18}
      borderRadius={9}
      borderWidth={1.5}
      borderColor={on ? "$primary" : "$text4"}
      alignItems="center"
      justifyContent="center"
    >
      {on && (
        <View
          width={8}
          height={8}
          borderRadius={4}
          backgroundColor="$primary"
        />
      )}
    </View>
  );
}

/** Canvas row 1c "Pick a workout": today's programme first, then your workouts. */
export function TogetherPickWorkoutPresenter(p: {
  today: readonly TogetherWorkoutOption[];
  others: readonly TogetherWorkoutOption[];
  selectedId: string | null;
  loading?: boolean;
  onSelect(id: string): void;
  onCreate(): void;
  onBack(): void;
}) {
  const insets = useSafeAreaInsets();
  const list = (items: readonly TogetherWorkoutOption[]) => (
    <Card surface={0} pad={0} style={{ paddingHorizontal: 16 }}>
      {items.map((w, i) => (
        <Pressable
          key={w.id}
          accessibilityRole="radio"
          accessibilityLabel={`Choose ${w.name}`}
          accessibilityState={{ checked: p.selectedId === w.id }}
          onPress={() => p.onSelect(w.id)}
        >
          <View
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={12}
            minHeight={60}
            borderTopWidth={i ? 1 : 0}
            borderColor="$border"
          >
            <View flex={1} gap={2}>
              <Text
                fontFamily="$display"
                fontWeight="600"
                fontSize={14}
                color="$text"
              >
                {w.name}
              </Text>
              <Text fontFamily="$body" fontSize={12} color="$text3">
                {w.meta}
              </Text>
            </View>
            <Radio on={p.selectedId === w.id} />
          </View>
        </Pressable>
      ))}
    </Card>
  );
  const empty = !p.today.length && !p.others.length;
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="together-pick-workout"
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 8,
          paddingBottom: insets.bottom + 30,
          gap: 14,
        }}
      >
        <TogetherBackButton onPress={p.onBack} />
        <View gap={6}>
          <TogetherEyebrow>Start a shared session</TogetherEyebrow>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={32}
            letterSpacing={-1}
            color="$text"
          >
            Pick a workout
          </Text>
          <Text fontFamily="$body" fontSize={13} lineHeight={19} color="$text2">
            Everyone trains this plan. Each person logs their own numbers.
          </Text>
        </View>
        {p.today.length > 0 && (
          <>
            <TogetherEyebrow>Today in your programme</TogetherEyebrow>
            {list(p.today)}
          </>
        )}
        {p.others.length > 0 && (
          <>
            <TogetherEyebrow>Your workouts</TogetherEyebrow>
            {list(p.others)}
          </>
        )}
        {empty && (
          <Card surface={0}>
            <View gap={10}>
              <Text fontFamily="$body" fontSize={13} color="$text2">
                {p.loading
                  ? "Loading your workouts…"
                  : "No workouts available. Create a workout first."}
              </Text>
              {!p.loading && (
                <TogetherBtn onPress={p.onCreate}>Create a workout</TogetherBtn>
              )}
            </View>
          </Card>
        )}
      </ScrollView>
    </View>
  );
}
