import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, ScreenGlow } from "@/ui/components/foundation";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { TogetherBackButton } from "./TogetherBackButton";
import { TogetherBtn } from "./TogetherBtn";
import { TogetherEyebrow } from "./TogetherEyebrow";

export interface TogetherBlockedPerson {
  userId: string;
  name: string;
}

/** Together settings › Blocked people: the list with Unblock (PER-60). */
export function TogetherBlockedPresenter(p: {
  people: readonly TogetherBlockedPerson[] | null;
  busy?: boolean;
  notice?: string;
  onUnblock(userId: string): void;
  onBack(): void;
}) {
  const insets = useSafeAreaInsets();
  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="together-blocked"
    >
      <ScreenGlow />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingTop: 0,
          paddingBottom: insets.bottom + 30,
          gap: 14,
        }}
      >
        <TogetherBackButton onPress={p.onBack} />
        <View gap={6}>
          <TogetherEyebrow>Together settings</TogetherEyebrow>
          <Text
            fontFamily="$display"
            fontWeight="800"
            fontSize={32}
            lineHeight={38}
            letterSpacing={-1}
            color="$text"
          >
            Blocked people
          </Text>
          <Text fontFamily="$body" fontSize={13} lineHeight={19} color="$text2">
            They can’t find you, join your sessions or send requests. Unblocking
            never restores a partnership.
          </Text>
        </View>
        {p.people === null ? (
          <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
            Loading…
          </Text>
        ) : p.people.length === 0 ? (
          <Card surface={0}>
            <Text
              fontFamily="$body"
              fontSize={13}
              lineHeight={19}
              color="$text2"
            >
              Nobody is blocked.
            </Text>
          </Card>
        ) : (
          <Card surface={0} padX={16} padY={4}>
            {p.people.map((person, i) => (
              <View
                key={person.userId}
                flexDirection="row"
                alignItems="center"
                gap={12}
                paddingVertical={12}
                borderTopWidth={i ? 1 : 0}
                borderColor="$border"
              >
                <TogetherAthleteAvatar
                  name={person.name}
                  size={36}
                  tone="neutral"
                />
                <Text
                  flex={1}
                  fontFamily="$display"
                  fontWeight="600"
                  fontSize={14}
                  lineHeight={18}
                  color="$text"
                >
                  {person.name}
                </Text>
                <TogetherBtn
                  size="sm"
                  variant="quiet"
                  disabled={p.busy}
                  accessibilityLabel={`Unblock ${person.name}`}
                  onPress={() => p.onUnblock(person.userId)}
                >
                  Unblock
                </TogetherBtn>
              </View>
            ))}
          </Card>
        )}
        {!!p.notice && (
          <Text
            fontFamily="$body"
            fontSize={12}
            lineHeight={17}
            color="$warning"
            accessibilityRole="alert"
          >
            {p.notice}
          </Text>
        )}
      </ScrollView>
    </View>
  );
}
