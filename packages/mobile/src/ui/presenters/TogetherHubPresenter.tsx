import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { Text, View, useTheme } from "@tamagui/core";
import { LogIn, Play } from "lucide-react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn, Card } from "@/ui/components/foundation";
import { IconChevronR, iconDefaults } from "@/ui/components/icons";
import { TogetherAthleteAvatar } from "./TogetherAthleteAvatar";
import { TogetherBtn } from "./TogetherBtn";
import { TogetherEyebrow } from "./TogetherEyebrow";
import { color } from "@/ui/theme/tokens";

export interface TogetherHubPartner {
  userId: string;
  name: string;
  /** "July" — shown as "Partners since July". */
  since?: string;
  /** Set while the partner hosts an Online session. */
  live?: { sessionId: string; occupancy: number };
}

/** Canvas row 1 hub: title, Start / Join card, Training partners card, footnote. No nearby list. */
export function TogetherHubPresenter(p: {
  accessState: "pending" | "allowed" | "locked" | "unavailable";
  onUpgrade(): void;
  onRetry(): void;
  onStart(): void;
  onJoin(): void;
  partners: readonly TogetherHubPartner[];
  partnersError?: string;
  onPartner(userId: string): void;
  onJoinOnline(sessionId: string): void;
  refreshing: boolean;
  onRefresh(): void;
  error?: string;
  activeWorkout?: boolean;
  onResume?(): void;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const row = (
    key: string,
    first: boolean,
    leading: ReactNode,
    title: string,
    sub: string,
    trailing: ReactNode,
    onPress: (() => void) | undefined,
    label: string,
    muted = false,
  ) => {
    const body = (
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={12}
        borderTopWidth={first ? 0 : 1}
        borderColor="$border"
      >
        {leading}
        <View flex={1} minWidth={0} gap={2}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={14}
            lineHeight={18}
            color={muted ? "$text3" : "$text"}
          >
            {title}
          </Text>
          <Text fontFamily="$body" fontSize={12} lineHeight={17} color="$text3">
            {sub}
          </Text>
        </View>
        {trailing}
      </View>
    );
    return onPress ? (
      <Pressable
        key={key}
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
      >
        {body}
      </Pressable>
    ) : (
      <View key={key}>{body}</View>
    );
  };
  const chevron = (
    <IconChevronR {...iconDefaults({ size: 20 })} color={color.$text2} />
  );
  const action = (icon: ReactNode) => (
    <View
      width={36}
      height={36}
      borderRadius={9999}
      backgroundColor="$primaryDim"
      borderWidth={1}
      style={{ borderColor: "rgba(34,211,238,0.35)" }}
      alignItems="center"
      justifyContent="center"
    >
      {icon}
    </View>
  );
  return (
    <ScrollView
      style={{ flex: 1 }}
      refreshControl={
        <RefreshControl
          refreshing={p.refreshing}
          onRefresh={p.onRefresh}
          tintColor={theme.primary.val}
        />
      }
      contentContainerStyle={{
        paddingHorizontal: 20,
        paddingTop: 4,
        paddingBottom: insets.bottom + 140,
        gap: 16,
      }}
      testID="together-hub-content"
    >
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
              lineHeight={38}
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
            <Text
              color="$warning"
              fontFamily="$body"
              fontSize={13}
              accessibilityRole="alert"
            >
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
            <Card surface={0} padX={16} padY={4}>
              {row(
                "start",
                true,
                action(
                  <Play size={20} color={color.$primary} strokeWidth={1.75} />,
                ),
                "Start a session",
                "Pick a workout, then Nearby or Online",
                chevron,
                p.onStart,
                "Start a session",
              )}
              {row(
                "join",
                false,
                action(
                  <LogIn size={20} color={color.$primary} strokeWidth={1.75} />,
                ),
                "Join a session",
                "Scan a QR, enter a code, or find one nearby",
                chevron,
                p.onJoin,
                "Join a session",
              )}
            </Card>
          )}
          <View gap={8}>
            <TogetherEyebrow>{`Training partners · ${p.partners.length}`}</TogetherEyebrow>
            {!!p.partnersError && (
              <Text
                color="$warning"
                fontFamily="$body"
                fontSize={12}
                lineHeight={17}
                accessibilityRole="alert"
              >
                {p.partnersError}
              </Text>
            )}
            {p.partners.length > 0 ? (
              <Card surface={0} padX={16} padY={4}>
                {p.partners.map((partner, i) =>
                  row(
                    partner.userId,
                    i === 0,
                    <TogetherAthleteAvatar
                      name={partner.name}
                      size={36}
                      tone={partner.live ? "info" : "neutral"}
                    />,
                    partner.name,
                    partner.live && !p.activeWorkout
                      ? `Training now · ${partner.live.occupancy} of 4 · Online`
                      : partner.since
                        ? `Partners since ${partner.since}`
                        : "Training partner",
                    partner.live && !p.activeWorkout ? (
                      <TogetherBtn
                        size="sm"
                        variant={partner.live.occupancy >= 4 ? "quiet" : "soft"}
                        disabled={partner.live.occupancy >= 4}
                        accessibilityLabel={`Join ${partner.name}`}
                        onPress={() => p.onJoinOnline(partner.live!.sessionId)}
                      >
                        {partner.live.occupancy >= 4 ? "Full" : "Join"}
                      </TogetherBtn>
                    ) : (
                      chevron
                    ),
                    () => p.onPartner(partner.userId),
                    `View ${partner.name}`,
                  ),
                )}
              </Card>
            ) : (
              <Card surface={0}>
                <Text
                  fontFamily="$body"
                  fontSize={13}
                  lineHeight={19}
                  color="$text2"
                >
                  No training partners yet. Share your code from the top of this
                  screen, or find someone by name.
                </Text>
              </Card>
            )}
            <Text
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text3"
            >
              A partner’s session shows here when it’s Online. Nearby sessions
              show in Join a session, after a search.
            </Text>
          </View>
        </>
      )}
    </ScrollView>
  );
}
