import { RefreshControl, ScrollView } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { Card, HeaderBar, IconBtn } from "@/ui/components/foundation";
import { EmptyState, ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconBack } from "@/ui/components/icons";
import type { BodyTrendPoint } from "@/domain/models/progress";
import type { ApiError } from "@/shared/errors";
import { weightInUnit, type WeightUnit } from "@/shared/utils";

export type BodyHistoryPresenterProps = {
  points: BodyTrendPoint[];
  weightUnit: WeightUnit;
  isLoading: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  onBack: () => void;
  onRefresh: () => void;
};

function displayDate(iso: string): string {
  return new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

/** Past-year body-measurement history reached from either You-page trend card. */
export function BodyHistoryPresenter({
  points,
  weightUnit,
  isLoading,
  isRefreshing,
  error,
  onBack,
  onRefresh,
}: BodyHistoryPresenterProps) {
  return (
    <View flex={1} backgroundColor="$bg" testID="body-history-screen">
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <HeaderBar
          eyebrow="PAST 12 MONTHS"
          title="Measurement history"
          large
          leading={
            <IconBtn
              icon={<IconBack size={20} />}
              tone="ghost"
              onPress={onBack}
              accessibilityLabel="Back"
            />
          }
        />

        {isLoading && points.length === 0 ? (
          <View
            flex={1}
            alignItems="center"
            justifyContent="center"
            testID="body-history-loader"
          >
            <PLogoDrawLoader />
          </View>
        ) : error && points.length === 0 ? (
          <View flex={1} testID="body-history-error">
            <ErrorState
              message="Couldn't load your body history."
              onRetry={onRefresh}
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 100 }}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
            }
          >
            {points.length === 0 ? (
              <EmptyState
                title="No measurements yet"
                description="Log a weigh-in to start your body trend."
                testID="body-history-empty"
              />
            ) : (
              <View gap={10}>
                {[...points].reverse().map((point, index) => {
                  const rowKey =
                    point.id ??
                    point.measuredAt ??
                    `${point.date}-${point.weightKg}-${point.bodyFat}-${index}`;
                  return (
                    <Card
                      key={rowKey}
                      pad={14}
                      radius={14}
                      testID={`body-history-row-${rowKey}`}
                    >
                      <View
                        flexDirection="row"
                        alignItems="center"
                        justifyContent="space-between"
                        gap={12}
                      >
                        <Text fontSize={13} color="$text2">
                          {displayDate(point.date)}
                        </Text>
                        <View flexDirection="row" gap={14}>
                          <Text fontFamily="$mono" fontSize={13} color="$text">
                            {point.weightKg != null
                              ? `${weightInUnit(point.weightKg, weightUnit).toFixed(1)} ${weightUnit}`
                              : "—"}
                          </Text>
                          <Text fontFamily="$mono" fontSize={13} color="$text">
                            {point.bodyFat != null
                              ? `${point.bodyFat.toFixed(1)}%`
                              : "—"}
                          </Text>
                        </View>
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </View>
  );
}
