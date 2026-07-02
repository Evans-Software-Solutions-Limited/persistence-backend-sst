import { ScrollView } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Btn, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { Section } from "@/ui/components/composite";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconBack, IconPlus } from "@/ui/components/icons";
import {
  BodyTrendPresenter,
  type TrendData,
} from "@/ui/presenters/BodyTrendPresenter";

/**
 * <ClientDetailPresenter> — interim Client Detail slice (10-trainer-features
 * 10.9.3): client body trend + the Log-weight action. The full 5-tab screen
 * (Overview / Workouts / Nutrition / Notes / Settings, per design.md
 * § Frontend — Client Detail) is a later slice; this replaces the bare
 * ComingSoon stub with the one read surface that's wired today, reusing the
 * athlete-side <BodyTrendPresenter> unchanged.
 */

export type ClientDetailProps = {
  clientName: string | null;
  bodyTrend: { weight: TrendData & { unit: "kg" | "lb" }; bodyFat: TrendData };
  /** True until the first trend fetch resolves. */
  isLoading: boolean;
  error: string | null;
  onLogWeight: () => void;
  onBack: () => void;
};

export function ClientDetailPresenter({
  clientName,
  bodyTrend,
  isLoading,
  error,
  onLogWeight,
  onBack,
}: ClientDetailProps) {
  const insets = useSafeAreaInsets();
  const hasData =
    bodyTrend.weight.series.length > 0 || bodyTrend.bodyFat.series.length > 0;

  return (
    <View flex={1} paddingTop={insets.top} testID="client-detail">
      <HeaderBar
        eyebrow="COACHING"
        title={clientName ?? "Client"}
        leading={
          <IconBtn
            icon={<IconBack size={20} />}
            tone="neutral"
            onPress={onBack}
            accessibilityLabel="Back"
          />
        }
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ padding: 20, gap: 20 }}
      >
        <Section eyebrow="BODY" title="Trend" testID="client-detail-body">
          <BodyTrendPresenter
            weight={bodyTrend.weight}
            bodyFat={bodyTrend.bodyFat}
            testID="client-detail-body-trend"
          />
          {!isLoading && !error && !hasData ? (
            <Text
              fontSize={13}
              color="$text3"
              marginTop={10}
              testID="client-detail-empty"
            >
              No measurements in the last 30 days — log a weight to start the
              trend.
            </Text>
          ) : null}
          {error ? (
            <Text
              fontSize={13}
              color="$error"
              marginTop={10}
              testID="client-detail-error"
            >
              {error}
            </Text>
          ) : null}
        </Section>

        <Text fontSize={12} color="$text3">
          Programs, notes and session history arrive in a later slice.
        </Text>
      </ScrollView>

      <View
        paddingHorizontal={20}
        paddingTop={12}
        paddingBottom={insets.bottom + 20}
      >
        <Btn
          full
          variant="filled"
          tone="trainer"
          icon={<IconPlus size={16} color={toneHex("trainer").ink} />}
          onPress={onLogWeight}
          testID="client-detail-log-weight"
        >
          Log weight
        </Btn>
      </View>
    </View>
  );
}
