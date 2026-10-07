import { Btn } from "@/ui/components/foundation/Btn";
import { ScrollView } from "react-native";
import { Text, View, useTheme } from "@tamagui/core";
import { Card } from "@/ui/components/foundation/Card";
import { IconUsers, IconChevronR } from "@/ui/components/icons";

/** Train → Together entry cards from the reviewed social.jsx hub. */
export function TogetherHubPresenter({
  onWorkouts,
  onPartners,
  accessState,
  onUpgrade,
  onRetry,
}: {
  onWorkouts(): void;
  onPartners(): void;
  accessState: "pending" | "allowed" | "locked" | "unavailable";
  onUpgrade(): void;
  onRetry(): void;
}) {
  const theme = useTheme();
  return (
    <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 120 }}>
      <View gap={16}>
        {accessState !== "allowed" && (
          <Card testID="together-access-gate">
            <View gap={12}>
              <Text
                fontFamily="$display"
                fontSize={17}
                fontWeight="700"
                color="$text"
              >
                {accessState === "locked"
                  ? "Train together · paid subscription"
                  : "Train together"}
              </Text>
              <Text fontFamily="$body" color="$text2">
                {accessState === "locked"
                  ? "Every athlete needs a qualifying paid subscription. Choose a plan to start or join a Together session."
                  : accessState === "pending"
                    ? "Checking your Together access…"
                    : "We couldn’t verify your Together access. Reconnect to prepare access, then try again. Your personal workout remains available."}
              </Text>
              {accessState === "locked" ? (
                <View gap={8}>
                  <Btn onPress={onUpgrade}>View subscriptions</Btn>
                  <Btn variant="ghost" onPress={onRetry}>
                    Check access again
                  </Btn>
                </View>
              ) : accessState === "unavailable" ? (
                <Btn onPress={onRetry}>Retry access check</Btn>
              ) : null}
            </View>
          </Card>
        )}
        {[
          {
            title: "Train together",
            detail:
              "Choose a workout, then start a session for up to four athletes",
            action: onWorkouts,
            compact: false,
          },
          {
            title: "Training partners",
            detail: "Your partners, requests and person code or QR",
            action: onPartners,
            compact: true,
          },
        ]
          .filter(({ compact }) => compact || accessState === "allowed")
          .map(({ title, detail, action, compact }) => (
            <View key={title} width={compact ? "50%" : "100%"}>
              <Card
                surface={1}
                pad={compact ? 13 : 16}
                radius={compact ? 14 : 16}
                accent={compact ? undefined : "primary"}
                onPress={action}
                accessibilityRole="button"
                accessibilityLabel={title}
              >
                <View
                  flexDirection={compact ? "column" : "row"}
                  alignItems={compact ? "flex-start" : "center"}
                  gap={compact ? 9 : 11}
                >
                  <View
                    width={compact ? 17 : 34}
                    height={compact ? 17 : 34}
                    borderRadius={11}
                    backgroundColor={compact ? "transparent" : "$primaryDim"}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <IconUsers size={17} color={theme.primary.val} />
                  </View>
                  <View flex={compact ? undefined : 1}>
                    <Text
                      textAlign="left"
                      fontFamily="$display"
                      fontSize={compact ? 13 : 15}
                      fontWeight="700"
                      color="$text"
                    >
                      {title}
                    </Text>
                    <Text
                      textAlign="left"
                      fontFamily="$body"
                      fontSize={compact ? 10.5 : 11.5}
                      color="$text3"
                      marginTop={2}
                    >
                      {detail}
                    </Text>
                  </View>
                  {!compact && (
                    <IconChevronR size={18} color={theme.text3!.val} />
                  )}
                </View>
              </Card>
            </View>
          ))}
      </View>
    </ScrollView>
  );
}
