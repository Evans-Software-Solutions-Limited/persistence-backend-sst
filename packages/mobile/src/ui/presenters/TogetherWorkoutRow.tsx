import { Text, View } from "@tamagui/core";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
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
      gap={8}
      paddingHorizontal={16}
      backgroundColor="$surface"
      testID="together-workout-row"
    >
      {p.members.map((m) => (
        <TogetherAthleteAvatar
          key={m.userId}
          name={m.name}
          selected={m.userId === p.selectedId}
          onPress={() => p.onSelect(m.userId)}
        />
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
