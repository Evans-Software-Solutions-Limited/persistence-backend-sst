import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";
import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn, Card, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import {
  IconBack,
  IconBolt,
  IconHealth,
  IconHeart,
  IconTrending,
  IconUser,
  iconDefaults,
} from "@/ui/components/icons";
import type { HealthPermissionStatus } from "@/domain/ports/health.port";

/**
 * <HealthSettingsPresenter> — Apple Health connect / status screen reached
 * from the ProfileDrawer "Health & integrations" row.
 *
 * Ports the legacy permission flow (persistence-mobile/app/health-permissions
 * + components/health/IOSHealthPermissionsContent) onto the V2 design system:
 * a hero card + "Connect Apple Health" CTA when not connected, and a connected
 * card + per-metric grant list + troubleshooting steps once granted. The
 * native HealthKit permission sheet is triggered by the container's
 * `onConnect` → `useHealthData().requestPermissions()`.
 *
 * Spec: specs/07-health-integration/requirements.md STORY-001/003/005
 *       design.md § M1 scope (UI tiles · platform adapter matrix)
 */

export type HealthSettingsPresenterProps = {
  /** HealthKit / Health Connect reachable on this build (false on simulator
   *  and Android M1). */
  isAvailable: boolean;
  permissionStatus: HealthPermissionStatus;
  /** A read is in flight (initial load or post-grant). */
  isReading: boolean;
  /** A permission request is in flight (button → native sheet). */
  isRequesting: boolean;
  /** Today's step count once granted, or null. Mirrors the MOVE ring. */
  stepsToday: number | null;
  onBack: () => void;
  onConnect: () => void;
  testID?: string;
};

type MetricRow = {
  key: keyof HealthPermissionStatus;
  label: string;
  icon: ReactNode;
};

const METRICS: readonly MetricRow[] = [
  {
    key: "steps",
    label: "Steps & activity",
    icon: <IconTrending {...iconDefaults({ size: 16 })} />,
  },
  {
    key: "calories",
    label: "Active energy",
    icon: <IconBolt {...iconDefaults({ size: 16 })} />,
  },
  {
    key: "bodyWeight",
    label: "Body weight",
    icon: <IconUser {...iconDefaults({ size: 16 })} />,
  },
  {
    key: "heartRate",
    label: "Heart rate",
    icon: <IconHeart {...iconDefaults({ size: 16 })} />,
  },
];

const TROUBLESHOOTING: readonly string[] = [
  "Open the Health app and tap your profile icon (top right).",
  "Scroll to Privacy and select Apps.",
  "Choose Persistence from the list.",
  "Turn on the data categories you want to share.",
];

function StatusDot({
  status,
}: {
  status: HealthPermissionStatus[keyof HealthPermissionStatus];
}) {
  const color =
    status === "granted"
      ? "$success"
      : status === "denied"
        ? "$error"
        : "$text3";
  return <View width={8} height={8} borderRadius={4} backgroundColor={color} />;
}

export function HealthSettingsPresenter({
  isAvailable,
  permissionStatus,
  isReading,
  isRequesting,
  stepsToday,
  onBack,
  onConnect,
  testID = "health-settings",
}: HealthSettingsPresenterProps) {
  const insets = useSafeAreaInsets();
  const connected = isAvailable && permissionStatus.steps === "granted";

  return (
    <View
      flex={1}
      backgroundColor="$background"
      paddingTop={insets.top}
      testID={testID}
    >
      <HeaderBar
        title="Health & integrations"
        leading={
          <IconBtn
            icon={<IconBack {...iconDefaults({ size: 20 })} />}
            tone="ghost"
            onPress={onBack}
            accessibilityLabel="Go back"
            testID="health-settings-back"
          />
        }
      />

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 48, gap: 16 }}
        testID="health-settings-scroll"
      >
        {/* Hero — Apple Health brand + status headline */}
        <Card pad={20} radius={20} surface={1}>
          <View alignItems="center" gap={12}>
            <View
              width={64}
              height={64}
              borderRadius={32}
              alignItems="center"
              justifyContent="center"
              backgroundColor={
                connected ? toneHex("success").dim : toneHex("ember").dim
              }
            >
              <IconHealth
                size={30}
                color={
                  connected ? toneHex("success").base : toneHex("ember").base
                }
              />
            </View>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={20}
              letterSpacing={-0.4}
              color="$text"
              textAlign="center"
            >
              {connected ? "Apple Health connected" : "Connect Apple Health"}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={13}
              lineHeight={19}
              color="$text2"
              textAlign="center"
            >
              {connected
                ? "Your steps and activity sync automatically to keep your rings and progress up to date."
                : "Sync your steps, workouts, and activity to keep your activity rings and progress up to date."}
            </Text>

            {!isAvailable ? (
              <Text
                fontFamily="$body"
                fontSize={12}
                color="$text3"
                textAlign="center"
                testID="health-unavailable"
              >
                Apple Health isn’t available on this device. Try again on an
                iPhone with the Health app installed.
              </Text>
            ) : !connected ? (
              <View width="100%" gap={8} marginTop={4}>
                <Btn
                  tone="ember"
                  variant="filled"
                  size="lg"
                  full
                  onPress={onConnect}
                  disabled={isRequesting}
                  icon={<IconHealth {...iconDefaults({ size: 18 })} />}
                  testID="health-connect-btn"
                >
                  {isRequesting ? "Requesting…" : "Connect Apple Health"}
                </Btn>
                <Text
                  fontFamily="$body"
                  fontSize={11}
                  color="$text3"
                  textAlign="center"
                >
                  We’ll ask permission to read your health data. You can change
                  individual data types anytime in the Health app.
                </Text>
              </View>
            ) : (
              <View
                flexDirection="row"
                alignItems="center"
                gap={6}
                marginTop={2}
                testID="health-steps-today"
              >
                <Text fontFamily="$body" fontSize={12} color="$text3">
                  {stepsToday != null
                    ? `${stepsToday.toLocaleString("en-US")} steps today`
                    : isReading
                      ? "Reading today’s activity…"
                      : "No steps recorded yet today"}
                </Text>
              </View>
            )}
          </View>
        </Card>

        {/* Per-metric grant list — what we read from Health */}
        <Card pad={4} radius={16} surface={1}>
          <View paddingHorizontal={12} paddingTop={12} paddingBottom={4}>
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={11}
              letterSpacing={1}
              color="$text3"
            >
              DATA WE SYNC
            </Text>
          </View>
          {METRICS.map((m, i) => (
            <View
              key={m.key}
              flexDirection="row"
              alignItems="center"
              gap={12}
              paddingHorizontal={12}
              paddingVertical={12}
              borderTopWidth={i === 0 ? 0 : 1}
              borderColor="$border"
              testID={`health-metric-${m.key}`}
            >
              <View opacity={0.8}>{m.icon}</View>
              <Text flex={1} fontFamily="$body" fontSize={14} color="$text">
                {m.label}
              </Text>
              <StatusDot status={permissionStatus[m.key]} />
            </View>
          ))}
        </Card>

        {/* Troubleshooting — ported from legacy IOSHealthPermissionsContent */}
        {isAvailable ? (
          <Card pad={16} radius={16} surface={1}>
            <Text
              fontFamily="$display"
              fontWeight="600"
              fontSize={13}
              color="$text"
              marginBottom={10}
            >
              If your data doesn’t show up
            </Text>
            <View gap={8}>
              {TROUBLESHOOTING.map((step, i) => (
                <View key={i} flexDirection="row" gap={10}>
                  <Text
                    fontFamily="$display"
                    fontWeight="700"
                    fontSize={12}
                    color={toneHex("ember").base}
                    width={14}
                  >
                    {i + 1}
                  </Text>
                  <Text
                    flex={1}
                    fontFamily="$body"
                    fontSize={13}
                    lineHeight={19}
                    color="$text2"
                  >
                    {step}
                  </Text>
                </View>
              ))}
            </View>
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
}
