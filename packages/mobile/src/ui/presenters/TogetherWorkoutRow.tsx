import { Text, View } from "@tamagui/core";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { Btn } from "@/ui/components/foundation/Btn";
import { Pressable, ScrollView } from "react-native";
export function TogetherWorkoutRow(p: {
  members: readonly { userId: string; name: string }[];
  selectedId: string;
  status: string;
  onSelect(id: string): void;
  onSettings(): void;
  onEnd(): void;
}) {
  return (
    <View backgroundColor="$surface" testID="together-workout-row">
      <View
        minHeight={44}
        flexDirection="row"
        alignItems="center"
        gap={8}
        paddingHorizontal={16}
      >
        <Text flex={1} color="$text2" fontFamily="$body" fontSize={11}>
          {p.status}
        </Text>
        <Btn
          size="sm"
          variant="ghost"
          accessibilityLabel="Together settings"
          onPress={p.onSettings}
        >
          Sharing
        </Btn>
        <Btn size="sm" variant="ghost" onPress={p.onEnd}>
          End
        </Btn>
      </View>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{
          paddingHorizontal: 16,
          gap: 8,
          paddingBottom: 8,
        }}
      >
        {p.members.map((m) => (
          <Pressable
            key={m.userId}
            onPress={() => p.onSelect(m.userId)}
            accessibilityRole="button"
            accessibilityLabel={`View ${m.name}’s workout`}
            accessibilityState={{ selected: m.userId === p.selectedId }}
          >
            <View
              minHeight={44}
              flexDirection="row"
              alignItems="center"
              gap={8}
              paddingHorizontal={10}
              borderRadius={12}
              borderWidth={1}
              borderColor={m.userId === p.selectedId ? "$primary" : "$border"}
              backgroundColor={
                m.userId === p.selectedId ? "$primaryDim" : "$surface"
              }
            >
              <TogetherAthleteAvatar
                name={m.name}
                selected={m.userId === p.selectedId}
              />
              <Text
                color={m.userId === p.selectedId ? "$primary" : "$text2"}
                fontSize={12}
              >
                {m.name}
              </Text>
            </View>
          </Pressable>
        ))}
      </ScrollView>
    </View>
  );
}
