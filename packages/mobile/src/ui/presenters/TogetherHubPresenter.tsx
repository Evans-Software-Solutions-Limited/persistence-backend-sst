import type { ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { LogIn, Play } from "lucide-react-native";
import { Btn, Card } from "@/ui/components/foundation";
import { IconChevronR, iconDefaults } from "@/ui/components/icons";
import { color } from "@/ui/theme/tokens";

/** Canvas row 1: Start, Join and partners' Online sessions only; no passive nearby list. */
export function TogetherHubPresenter(p: {
  accessState: "pending" | "allowed" | "locked" | "unavailable";
  onUpgrade(): void;
  onRetry(): void;
  onStart(): void;
  onJoin(): void;
  error?: string;
  activeWorkout?: boolean;
  onResume?(): void;
}) {
  const row = (
    icon: ReactNode,
    title: string,
    sub: string,
    onPress: () => void,
    first: boolean,
  ) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={title}
      onPress={onPress}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        borderTopWidth={first ? 0 : 1}
        borderColor="$border"
        minHeight={60}
      >
        <View
          width={36}
          height={36}
          borderRadius={99}
          backgroundColor="$primaryDim"
          borderWidth={1}
          borderColor="$primaryGlow"
          alignItems="center"
          justifyContent="center"
        >
          {icon}
        </View>
        <View flex={1} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            color="$text"
          >
            {title}
          </Text>
          <Text fontFamily="$body" fontSize={12} color="$text3">
            {sub}
          </Text>
        </View>
        <IconChevronR {...iconDefaults({ size: 20 })} color={color.$text2} />
      </View>
    </Pressable>
  );
  return (
    <View gap={16} testID="together-hub-content">
      {p.accessState !== "allowed" ? (
        <Card testID="together-access-gate">
          <View gap={12}>
            <Text fontFamily="$display" fontSize={20} color="$text">
              Train together
            </Text>
            <Text color="$text2" fontFamily="$body">
              {p.accessState === "locked"
                ? "Every athlete needs a qualifying paid subscription."
                : p.accessState === "pending"
                  ? "Checking your Together access…"
                  : "We couldn’t verify your Together access. Your personal workout remains available."}
            </Text>
            {p.accessState === "locked" ? (
              <>
                <Btn onPress={p.onUpgrade}>View subscriptions</Btn>
                <Btn variant="ghost" onPress={p.onRetry}>
                  Check access again
                </Btn>
              </>
            ) : p.accessState === "unavailable" ? (
              <Btn onPress={p.onRetry}>Retry access check</Btn>
            ) : null}
          </View>
        </Card>
      ) : (
        <>
          <View gap={6}>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={32}
              letterSpacing={-1}
              color="$text"
            >
              Train together
            </Text>
            <Text
              fontFamily="$body"
              fontSize={13}
              lineHeight={19}
              color="$text2"
            >
              Up to 4 people. Everyone logs their own sets and keeps their own
              workout.
            </Text>
          </View>
          {!!p.error && (
            <Text color="$warning" fontFamily="$body" accessibilityRole="alert">
              {p.error}
            </Text>
          )}
          {p.activeWorkout ? (
            <Card surface={0}>
              <View gap={10}>
                <Text color="$text2" fontFamily="$body">
                  Your Together workout is already active.
                </Text>
                <Btn onPress={() => p.onResume?.()}>Back to my workout</Btn>
              </View>
            </Card>
          ) : (
            <Card surface={0} pad={0} style={{ paddingHorizontal: 16 }}>
              {row(
                <Play size={20} color={color.$primary} strokeWidth={1.75} />,
                "Start a session",
                "Pick a workout, then Nearby or Online",
                p.onStart,
                true,
              )}
              {row(
                <LogIn size={20} color={color.$primary} strokeWidth={1.75} />,
                "Join a session",
                "Scan a QR, enter a code, or find one nearby",
                p.onJoin,
                false,
              )}
            </Card>
          )}
        </>
      )}
    </View>
  );
}
