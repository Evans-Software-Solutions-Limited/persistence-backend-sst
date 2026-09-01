import { useMemo, useState } from "react";
import { RefreshControl, ScrollView } from "react-native";
import Svg, { Circle, Path } from "react-native-svg";
import { SafeAreaView } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import {
  Btn,
  Card,
  HeaderBar,
  IconBtn,
  Segmented,
} from "@/ui/components/foundation";
import { EmptyState, ErrorState, PLogoDrawLoader } from "@/ui/components";
import { IconBack, IconPlus } from "@/ui/components/icons";
import { toneHex } from "@/ui/components/foundation/tones";
import type { BodyTrendPoint } from "@/domain/models/progress";
import type { ApiError } from "@/shared/errors";
import { weightInUnit, type WeightUnit } from "@/shared/utils";
import type { BodyHistoryMetric } from "@/ui/containers/BodyHistoryContainer";
import { computePath } from "./charts";

export type BodyHistoryPresenterProps = {
  points: BodyTrendPoint[];
  metric?: BodyHistoryMetric;
  weightUnit: WeightUnit;
  isLoading: boolean;
  isRefreshing: boolean;
  error: ApiError | null;
  onBack: () => void;
  onRefresh: () => void;
  onLog?: () => void;
};

type Range = "1m" | "3m" | "12m";
const RANGE_DAYS: Record<Range, number> = { "1m": 31, "3m": 92, "12m": 366 };
const CHART_WIDTH = 320;
const CHART_HEIGHT = 128;

function displayDate(iso: string): string {
  return new Date(`${iso}T12:00:00.000Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function metricValue(
  point: BodyTrendPoint,
  metric: BodyHistoryMetric,
): number | null {
  return metric === "weight" ? point.weightKg : point.bodyFat;
}

function pointTime(point: BodyTrendPoint): number {
  return new Date(point.measuredAt ?? `${point.date}T12:00:00.000Z`).getTime();
}

/** Full rows sorted by timestamp plus latest-per-calendar-day chart points. */
export function prepareMetricHistory(
  points: BodyTrendPoint[],
  metric: BodyHistoryMetric,
): { entries: BodyTrendPoint[]; graphPoints: BodyTrendPoint[] } {
  const entries = points
    .filter((point) => metricValue(point, metric) != null)
    .sort((a, b) => pointTime(a) - pointTime(b));
  const latestByDay = new Map<string, BodyTrendPoint>();
  for (const point of entries) latestByDay.set(point.date, point);
  return { entries, graphPoints: [...latestByDay.values()] };
}

/** Separate Weight / Body Fat history pages backed by the shared measurement read. */
export function BodyHistoryPresenter({
  points,
  metric = "weight",
  weightUnit,
  isLoading,
  isRefreshing,
  error,
  onBack,
  onRefresh,
  onLog = () => {},
}: BodyHistoryPresenterProps) {
  const [range, setRange] = useState<Range>("3m");
  const title = metric === "weight" ? "Weight" : "Body Fat";
  const unit = metric === "weight" ? weightUnit : "%";
  const prepared = useMemo(
    () => prepareMetricHistory(points, metric),
    [points, metric],
  );
  const metricPoints = prepared.entries;
  const rangedPoints = useMemo(() => {
    const cutoff = Date.now() - RANGE_DAYS[range] * 24 * 60 * 60 * 1000;
    return prepared.graphPoints.filter(
      (point) => new Date(`${point.date}T12:00:00.000Z`).getTime() >= cutoff,
    );
  }, [prepared.graphPoints, range]);
  const values = rangedPoints.map(
    (point) => metricValue(point, metric) as number,
  );
  const { line, lastPoint } = computePath(
    values,
    { w: CHART_WIDTH, h: CHART_HEIGHT },
    0.12,
  );
  const latest = metricPoints.at(-1);
  const previous = metricPoints.at(-2);
  const displayValue = (point: BodyTrendPoint | undefined) => {
    if (!point) return null;
    const value = metricValue(point, metric);
    if (value == null) return null;
    return metric === "weight" ? weightInUnit(value, weightUnit) : value;
  };
  const latestValue = displayValue(latest);
  const change =
    latestValue != null
      ? latestValue - (displayValue(previous) ?? latestValue)
      : 0;
  const bodyFatMin = values.length ? Math.min(...values) : 0;
  const bodyFatSpan =
    (values.length ? Math.max(...values) : 1) - bodyFatMin || 1;

  return (
    <View flex={1} backgroundColor="$bg" testID={`${metric}-history-screen`}>
      <SafeAreaView style={{ flex: 1 }} edges={["top"]}>
        <HeaderBar
          eyebrow="BODY"
          title={title}
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
              message={`Couldn't load your ${title.toLowerCase()} history.`}
              onRetry={onRefresh}
            />
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={{ padding: 16, paddingBottom: 100, gap: 14 }}
            refreshControl={
              <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
            }
          >
            <Card pad={16} radius={16} testID="body-history-summary">
              <Text
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.5}
                color="$text3"
              >
                LATEST
              </Text>
              <View
                flexDirection="row"
                alignItems="baseline"
                gap={5}
                marginTop={5}
              >
                <Text
                  fontFamily="$mono"
                  fontSize={30}
                  fontWeight="600"
                  color="$text"
                >
                  {latestValue?.toFixed(1) ?? "—"}
                </Text>
                <Text fontFamily="$mono" fontSize={13} color="$text3">
                  {unit}
                </Text>
              </View>
              {latestValue != null ? (
                <Text fontSize={12} color={change <= 0 ? "$success" : "$ember"}>
                  {change <= 0 ? "▼" : "▲"} {Math.abs(change).toFixed(1)} {unit}{" "}
                  from previous
                </Text>
              ) : null}
            </Card>

            <Segmented
              options={[
                { value: "1m", label: "1M" },
                { value: "3m", label: "3M" },
                { value: "12m", label: "12M" },
              ]}
              value={range}
              onChange={(next) => setRange(next as Range)}
              full
              testID="body-history-range"
            />

            <Card pad={14} radius={16} testID="body-history-chart">
              <View height={CHART_HEIGHT}>
                {values.length > 1 && metric === "weight" ? (
                  <Svg
                    width="100%"
                    height={CHART_HEIGHT}
                    viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
                    preserveAspectRatio="none"
                    accessibilityLabel={`${title} trend for ${range}`}
                  >
                    <Path
                      d={line}
                      fill="none"
                      stroke={toneHex("primary").base}
                      strokeWidth={2.5}
                    />
                    <Circle
                      cx={lastPoint[0]}
                      cy={lastPoint[1]}
                      r={4}
                      fill={toneHex("primary").base}
                    />
                  </Svg>
                ) : values.length > 1 ? (
                  <View
                    flex={1}
                    flexDirection="row"
                    alignItems="flex-end"
                    gap={4}
                    accessibilityLabel={`Body fat trend for ${range}`}
                  >
                    {values.map((value, index) => (
                      <View
                        key={`${rangedPoints[index]?.date}-${index}`}
                        flex={1}
                        minHeight={7}
                        height={`${Math.max(7, ((value - bodyFatMin) / bodyFatSpan) * 100)}%`}
                        backgroundColor="$primaryDim"
                        borderTopWidth={2}
                        borderColor="$primary"
                        borderRadius={2}
                      />
                    ))}
                  </View>
                ) : (
                  <View flex={1} alignItems="center" justifyContent="center">
                    <Text color="$text3" fontSize={12}>
                      Not enough data for this range
                    </Text>
                  </View>
                )}
              </View>
            </Card>

            {metricPoints.length === 0 ? (
              <EmptyState
                title={`No ${title.toLowerCase()} measurements yet`}
                description={`Log ${title.toLowerCase()} to start your trend.`}
                testID="body-history-empty"
              />
            ) : (
              <View gap={10}>
                {[...metricPoints].reverse().map((point, index) => {
                  const rowKey =
                    point.id ??
                    point.measuredAt ??
                    `${point.date}-${metricValue(point, metric)}-${index}`;
                  const value = displayValue(point);
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
                        <View flex={1}>
                          <Text fontSize={13} color="$text2">
                            {displayDate(point.date)}
                          </Text>
                          {point.source ? (
                            <Text fontSize={10.5} color="$text3" marginTop={2}>
                              {point.source}
                            </Text>
                          ) : null}
                        </View>
                        <Text fontFamily="$mono" fontSize={14} color="$text">
                          {value?.toFixed(1)} {unit}
                        </Text>
                      </View>
                    </Card>
                  );
                })}
              </View>
            )}
          </ScrollView>
        )}
        {!isLoading || points.length > 0 ? (
          <View
            paddingHorizontal={16}
            paddingTop={10}
            paddingBottom={14}
            backgroundColor="$bg"
            borderTopWidth={1}
            borderColor="$border"
          >
            <Btn
              full
              icon={<IconPlus size={17} />}
              onPress={onLog}
              testID={`log-${metric}-button`}
            >
              {metric === "weight" ? "Log weight" : "Log body fat"}
            </Btn>
          </View>
        ) : null}
      </SafeAreaView>
    </View>
  );
}
