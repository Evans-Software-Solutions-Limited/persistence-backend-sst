import type { ReactNode } from "react";
import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconPlus } from "@/ui/components/icons";

/**
 * PER-129 K shell — the coach Library tab (canvas C10g header). "Library"
 * label, the segment's name as the title, the segment tabs, then the body.
 * The new-form button sits beside the title on Forms only.
 */

export const LIBRARY_SEGMENTS = [
  "workouts",
  "programmes",
  "meals",
  "resources",
  "forms",
] as const;
export type LibrarySegment = (typeof LIBRARY_SEGMENTS)[number];

export const LIBRARY_SEGMENT_LABELS: Record<LibrarySegment, string> = {
  workouts: "Workouts",
  programmes: "Programmes",
  meals: "Meals",
  resources: "Resources",
  forms: "Forms",
};

export function isLibrarySegment(v: unknown): v is LibrarySegment {
  return (
    typeof v === "string" && (LIBRARY_SEGMENTS as readonly string[]).includes(v)
  );
}

export type CoachLibraryPresenterProps = {
  segment: LibrarySegment;
  onSegment: (segment: LibrarySegment) => void;
  onNewForm: () => void;
  children: ReactNode;
};

export function CoachLibraryPresenter(p: CoachLibraryPresenterProps) {
  const insets = useSafeAreaInsets();
  return (
    <View flex={1} paddingTop={insets.top} testID="coach-library">
      <View paddingHorizontal={20}>
        <Text fontFamily="$body" fontWeight="500" fontSize={13} color="$text3">
          Library
        </Text>
        <View flexDirection="row" alignItems="center">
          <Text
            flex={1}
            fontFamily="$display"
            fontWeight="800"
            fontSize={34}
            lineHeight={40}
            letterSpacing={-1}
            color="$text"
            accessibilityRole="header"
            testID="coach-library-title"
          >
            {LIBRARY_SEGMENT_LABELS[p.segment]}
          </Text>
          {p.segment === "forms" ? (
            <Pressable
              onPress={p.onNewForm}
              accessibilityRole="button"
              accessibilityLabel="New form"
              testID="coach-library-new-form"
            >
              <View
                width={44}
                height={44}
                borderRadius={9999}
                alignItems="center"
                justifyContent="center"
                backgroundColor="rgba(167,139,250,0.14)"
                borderWidth={1}
                borderColor="rgba(167,139,250,0.4)"
              >
                <IconPlus size={20} color="#C4B5FD" />
              </View>
            </Pressable>
          ) : null}
        </View>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0, marginTop: 12 }}
          contentContainerStyle={{
            gap: 2,
            borderBottomWidth: 1,
            borderBottomColor: "rgba(255,255,255,0.08)",
            flexGrow: 1,
          }}
          accessibilityRole="tablist"
          accessibilityLabel="Library"
          testID="coach-library-segments"
        >
          {LIBRARY_SEGMENTS.map((s) => {
            const on = s === p.segment;
            return (
              <Pressable
                key={s}
                onPress={() => p.onSegment(s)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                testID={`coach-library-segment-${s}`}
              >
                <View
                  height={40}
                  paddingHorizontal={8}
                  justifyContent="center"
                  borderBottomWidth={2}
                  borderBottomColor={on ? "#A78BFA" : "transparent"}
                >
                  <Text
                    fontFamily="$body"
                    fontWeight="600"
                    fontSize={13}
                    color={on ? "$text" : "$text3"}
                  >
                    {LIBRARY_SEGMENT_LABELS[s]}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
      <View flex={1}>{p.children}</View>
    </View>
  );
}
