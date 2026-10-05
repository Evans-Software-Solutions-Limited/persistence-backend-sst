import { Text, View } from "@tamagui/core";
import { Avatar } from "@/ui/components/foundation/Avatar";
import { Btn } from "@/ui/components/foundation/Btn";
import { IconBtn } from "@/ui/components/foundation/IconBtn";
import { IconSettings } from "@/ui/components/icons";
export function TogetherWorkoutRow(p: {
  members: readonly { userId: string; name: string }[];
  selectedId: string;
  status: string;
  onSelect(id: string): void;
  onSettings(): void;
  onEnd(): void;
}) {
  return (
    <View
      minHeight={44}
      flexDirection="row"
      alignItems="center"
      gap={6}
      paddingHorizontal={16}
      backgroundColor="$surface"
      testID="together-workout-row"
    >
      {p.members.map((m) => (
        <View
          key={m.userId}
          borderWidth={1}
          borderRadius={30}
          padding={2}
          borderColor={m.userId === p.selectedId ? "$primary" : "transparent"}
        >
          <Avatar
            size={24}
            initials={m.name
              .trim()
              .split(/\s+/)
              .map((x) => x[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
            accessibilityLabel={`View ${m.name}’s workout`}
            onPress={() => p.onSelect(m.userId)}
          />
        </View>
      ))}
      <Text flex={1} color="$text2" fontFamily="$body" fontSize={11}>
        {p.status}
      </Text>
      <Btn size="sm" variant="ghost" onPress={p.onEnd}>
        End
      </Btn>
      <IconBtn
        size={30}
        tone="ghost"
        icon={<IconSettings size={16} />}
        accessibilityLabel="Together settings"
        onPress={p.onSettings}
      />
    </View>
  );
}
