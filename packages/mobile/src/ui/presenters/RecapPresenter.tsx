import { useRef, useState } from "react";
import { Pressable, StyleSheet } from "react-native";
import Carousel, {
  type ICarouselInstance,
} from "react-native-reanimated-carousel";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";
import { ScreenGlow } from "@/ui/components/foundation/ScreenGlow";
import { IconShareUp, IconX } from "@/ui/components/icons";
import { MuscleMap } from "@/ui/components/summary/MuscleMap";
import type { BodyMapShading, RecapPeriod } from "@/domain/services/youPage";
import { color } from "@/ui/theme/tokens";
import { IconButton, LiftRow, type LiftRowData } from "./you/youKit";

/**
 * <RecapPresenter> — Y4 See a recap (PER-141, note `yn1`): This week · This
 * month · 3 months, then the same swipeable pages as the end of a workout
 * with no Next button (swipe, tap the page or the dots): totals, muscle
 * balance (map + bars), top lifts, volume, records (gold), trained
 * together. Each page shares from the top-right button. Pages with no data
 * aren't shown. Pure.
 */

export type RecapBigPage = {
  kind: "big";
  id: "totals" | "volume" | "records" | "together";
  eyebrow: string;
  big: string;
  unit: string;
  sub: string;
  trio: readonly { value: string; label: string }[];
  gold?: boolean;
};

export type RecapMusclePage = {
  kind: "muscles";
  id: "muscles";
  eyebrow: string;
  shading: BodyMapShading;
  rows: readonly { label: string; share: number }[];
};

export type RecapListPage = {
  kind: "list";
  id: "lifts";
  eyebrow: string;
  lifts: readonly LiftRowData[];
};

export type RecapPage = RecapBigPage | RecapMusclePage | RecapListPage;

export type RecapPresenterProps = {
  period: RecapPeriod;
  pages: readonly RecapPage[];
  gender: "male" | "female";
  /** Set when the phone's log doesn't cover the whole period (BE-H1 seam). */
  coverageNote: string | null;
  onPeriod(period: RecapPeriod): void;
  onClose(): void;
  onShare(page: RecapPage): void;
};

const PERIODS: { id: RecapPeriod; label: string }[] = [
  { id: "week", label: "This week" },
  { id: "month", label: "This month" },
  { id: "3months", label: "3 months" },
];

const PAGE_LABEL: Record<RecapPage["id"], string> = {
  totals: "Totals",
  muscles: "Muscle balance",
  lifts: "Top lifts",
  volume: "Volume",
  records: "Records",
  together: "Trained together",
};

export function RecapPresenter(p: RecapPresenterProps) {
  const insets = useSafeAreaInsets();
  const [index, setIndex] = useState(0);
  const [size, setSize] = useState<{ width: number; height: number } | null>(
    null,
  );
  const carousel = useRef<ICarouselInstance>(null);
  const current = Math.min(index, p.pages.length - 1);
  const swiped = useRef(false);
  const go = (i: number) => {
    setIndex(i);
    carousel.current?.scrollTo({ index: i, animated: true });
  };

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID="recap-screen"
    >
      <ScreenGlow />
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal={16}
        height={52}
      >
        <IconButton label="Close" onPress={p.onClose} testID="recap-close">
          <IconX size={20} color={color.$text} />
        </IconButton>
        <View
          flexDirection="row"
          gap={2}
          padding={3}
          borderRadius={999}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="rgba(255,255,255,0.08)"
          accessibilityRole="tablist"
          accessibilityLabel="Recap period"
        >
          {PERIODS.map((x) => {
            const on = x.id === p.period;
            return (
              <Pressable
                key={x.id}
                onPress={() => {
                  setIndex(0);
                  carousel.current?.scrollTo({ index: 0, animated: false });
                  p.onPeriod(x.id);
                }}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                testID={`recap-period-${x.id}`}
              >
                <View
                  height={32}
                  paddingHorizontal={11}
                  borderRadius={999}
                  justifyContent="center"
                  backgroundColor={on ? "$surface4" : "transparent"}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="600"
                    fontSize={12.5}
                    color={on ? "$text" : "$text3"}
                  >
                    {x.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        <IconButton
          label="Share this page"
          onPress={() => p.onShare(p.pages[current]!)}
          testID="recap-share"
        >
          <IconShareUp size={20} color={color.$text} />
        </IconButton>
      </View>

      <View
        flex={1}
        onLayout={(e) => {
          const { width, height } = e.nativeEvent.layout;
          if (width && height) setSize({ width, height });
        }}
        testID="recap-pages"
      >
        {size && (
          <Carousel
            key={p.period}
            ref={carousel}
            width={size.width}
            height={size.height}
            data={p.pages as RecapPage[]}
            loop={false}
            defaultIndex={0}
            onSnapToItem={setIndex}
            onScrollStart={() => {
              swiped.current = true;
            }}
            onScrollEnd={() => {
              swiped.current = false;
            }}
            onConfigurePanGesture={(g) => {
              g.activeOffsetX([-10, 10]);
            }}
            renderItem={({ item, index: i }) => (
              <Pressable
                onPressIn={() => {
                  swiped.current = false;
                }}
                onPress={() => {
                  if (!swiped.current) go((i + 1) % p.pages.length);
                }}
                accessibilityRole="button"
                accessibilityLabel={`${PAGE_LABEL[item.id]}, page ${i + 1} of ${p.pages.length}`}
                accessibilityHint="Swipe sideways for the other pages"
                style={styles.page}
                testID={`recap-page-${item.id}`}
              >
                <Page page={item} gender={p.gender} />
              </Pressable>
            )}
          />
        )}
      </View>

      <View
        paddingHorizontal={20}
        paddingBottom={40}
        gap={16}
        alignItems="center"
      >
        {!!p.coverageNote && (
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$text3"
            textAlign="center"
            testID="recap-coverage"
          >
            {p.coverageNote}
          </Text>
        )}
        <View
          flexDirection="row"
          justifyContent="center"
          accessibilityRole="tablist"
          accessibilityLabel="Recap pages · swipe or tap the page"
        >
          {p.pages.map((page, i) => (
            <Pressable
              key={page.id}
              onPress={() => go(i)}
              accessibilityRole="tab"
              accessibilityLabel={`Page ${i + 1}`}
              accessibilityState={{ selected: i === current }}
              style={styles.dotHit}
              testID={`recap-dot-${page.id}`}
            >
              <View
                height={8}
                width={i === current ? 24 : 8}
                borderRadius={999}
                backgroundColor={i === current ? "$text" : "$surface5"}
              />
            </Pressable>
          ))}
        </View>
      </View>
    </View>
  );
}

function Page({
  page,
  gender,
}: {
  page: RecapPage;
  gender: "male" | "female";
}) {
  return (
    <View
      flex={1}
      paddingHorizontal={28}
      justifyContent="center"
      alignItems="center"
    >
      <Text fontFamily="$display" fontWeight="600" fontSize={13} color="$text2">
        Persistence
      </Text>
      <Text
        marginTop={18}
        fontFamily="$display"
        fontWeight="600"
        fontSize={12}
        lineHeight={16}
        letterSpacing={3}
        textTransform="uppercase"
        textAlign="center"
        color="$text2"
      >
        {page.eyebrow}
      </Text>
      {page.kind === "big" ? (
        <BigPage page={page} />
      ) : page.kind === "muscles" ? (
        <>
          <View marginTop={10}>
            <MuscleMap
              muscles={page.shading}
              height={156}
              gap={2}
              gender={gender}
              testID="recap-muscle-map"
            />
          </View>
          <View alignSelf="stretch" marginTop={10}>
            {page.rows.map((r) => (
              <MuscleRow
                key={r.label}
                label={r.label}
                share={r.share}
                max={page.rows[0]!.share}
              />
            ))}
          </View>
        </>
      ) : (
        <View alignSelf="stretch" marginTop={14}>
          {page.lifts.map((l) => (
            <LiftRow key={l.key} lift={l} />
          ))}
        </View>
      )}
    </View>
  );
}

function BigPage({ page }: { page: RecapBigPage }) {
  return (
    <>
      <View
        flexDirection="row"
        alignItems="baseline"
        justifyContent="center"
        marginTop={8}
      >
        <Text
          fontFamily="$mono"
          fontWeight="700"
          fontSize={84}
          lineHeight={88}
          letterSpacing={-4}
          color={page.gold ? "$gold" : "$text"}
          style={
            page.gold
              ? {
                  textShadowColor: "rgba(245,197,24,0.4)",
                  textShadowRadius: 40,
                }
              : undefined
          }
        >
          {page.big}
        </Text>
        <Text
          fontFamily="$mono"
          fontWeight="500"
          fontSize={22}
          color="$text3"
          marginLeft={6}
        >
          {page.unit}
        </Text>
      </View>
      {!!page.sub && (
        <Text
          fontFamily="$display"
          fontWeight="500"
          fontSize={15}
          color="$text2"
          marginTop={4}
          textAlign="center"
        >
          {page.sub}
        </Text>
      )}
      <View flexDirection="row" alignSelf="stretch" marginTop={26}>
        {page.trio.map((t, i) => (
          <View key={i} flex={1} gap={4} alignItems="center">
            <Text
              fontFamily="$mono"
              fontWeight="700"
              fontSize={24}
              lineHeight={28}
              color={page.gold ? "$gold" : "$text"}
            >
              {t.value}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={13}
              lineHeight={18}
              color="$text3"
            >
              {t.label}
            </Text>
          </View>
        ))}
      </View>
    </>
  );
}

/** Canvas `.mr`: name, bar shaded by share, percentage. */
function MuscleRow(p: { label: string; share: number; max: number }) {
  const fill =
    p.share >= 14
      ? color.$primary
      : p.share >= 9
        ? "rgba(34,211,238,0.75)"
        : p.share >= 5
          ? "rgba(34,211,238,0.5)"
          : "rgba(34,211,238,0.25)";
  return (
    <View flexDirection="row" alignItems="center" gap={10} paddingVertical={5}>
      <Text
        width={92}
        fontFamily="$display"
        fontWeight="500"
        fontSize={13.5}
        lineHeight={18}
        color="$text"
      >
        {p.label}
      </Text>
      <View
        flex={1}
        height={7}
        borderRadius={999}
        backgroundColor="$surface3"
        overflow="hidden"
      >
        <View
          height={7}
          borderRadius={999}
          width={`${p.max ? Math.round((p.share / p.max) * 100) : 0}%`}
          backgroundColor={fill}
        />
      </View>
      <Text
        width={40}
        textAlign="right"
        fontFamily="$mono"
        fontWeight="600"
        fontSize={12.5}
        lineHeight={18}
        color="$text"
      >
        {`${p.share}%`}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1 },
  dotHit: { padding: 3 },
});
