import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

export function TogetherWorkoutChoice(p: {
  name: string;
  exerciseCount: number;
  minutes?: number;
  exerciseNames: readonly string[];
  onPress(): void;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Choose ${p.name}`}
      onPress={p.onPress}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={16}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <View flex={1} gap={5} alignItems="flex-start">
          <Text
            color="$text"
            fontFamily="$display"
            fontSize={17}
            textAlign="left"
          >
            {p.name}
          </Text>
          <Text
            color="$text2"
            fontFamily="$body"
            fontSize={12}
            textAlign="left"
          >
            {p.exerciseCount} exercises
            {p.minutes && p.minutes > 0 ? ` · ${p.minutes} min` : ""}
          </Text>
          {!!p.exerciseNames.length && (
            <Text
              color="$text3"
              fontFamily="$body"
              fontSize={12}
              numberOfLines={1}
              textAlign="left"
            >
              {p.exerciseNames.slice(0, 3).join(" · ")}
            </Text>
          )}
        </View>
        <Text color="$text3" fontSize={22}>
          ›
        </Text>
      </View>
    </Pressable>
  );
}
