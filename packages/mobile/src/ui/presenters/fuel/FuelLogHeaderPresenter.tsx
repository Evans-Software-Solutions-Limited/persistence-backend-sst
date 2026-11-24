import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";
import { NEUTRAL_HEX } from "@/ui/components/foundation/tones";
import { IconCalendar, IconPlus, IconTarget } from "@/ui/components/icons";
import type { WeekDayState } from "@/domain/services/userMeals.service";

/**
 * <FuelLogHeaderPresenter> — top of canvas N1 (PER-132): the "Fuel" title
 * with its two round buttons, the Log · Plan · Meals switch with the day
 * label, and the Monday–Sunday week strip.
 *
 * - Day dots: cyan ring = logged, red = over target, filled = today, dashed =
 *   nothing logged. The canvas's "planned" dot is gone (no plans on days).
 * - Future days can't be picked (Log is past and today only); the calendar
 *   button reaches earlier weeks.
 */

export type FuelSection = "log" | "plan" | "meals";

export type WeekDayVM = {
  iso: string;
  /** "Mon" */
  dayName: string;
  /** "23" */
  dayNum: string;
  state: WeekDayState;
  selected: boolean;
};

export type FuelLogHeaderProps = {
  section: FuelSection;
  onSection: (section: FuelSection) => void;
  dayLabel: string;
  week: readonly WeekDayVM[];
  onSelectDay: (iso: string) => void;
  onOpenCalendar: () => void;
  onOpenTargets: () => void;
  /**
   * PER-133: Meals (N11) has one round "New meal or recipe" button instead
   * of the calendar and targets; Plan (N6) has only targets. Neither shows
   * the day label or week strip (plans have no days).
   */
  onNew?: () => void;
  testID?: string;
};

const STATE_WORDS: Record<WeekDayState, string> = {
  logged: "logged",
  over: "over target",
  today: "today",
  future: "not yet",
  empty: "nothing logged",
};

function RoundBtn({
  label,
  onPress,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  children: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
      style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
    >
      <View
        width={44}
        height={44}
        borderRadius={9999}
        backgroundColor="rgba(255,255,255,0.06)"
        borderWidth={1}
        borderColor="$border"
        alignItems="center"
        justifyContent="center"
      >
        {children}
      </View>
    </Pressable>
  );
}

function dotStyle(state: WeekDayState): {
  borderColor: string;
  borderStyle: "solid" | "dashed";
  backgroundColor: string;
  color: string;
} {
  switch (state) {
    case "logged":
      return {
        borderColor: "#22D3EE",
        borderStyle: "solid",
        backgroundColor: "transparent",
        color: "#F4F4F8",
      };
    case "over":
      return {
        borderColor: "#F87171",
        borderStyle: "solid",
        backgroundColor: "transparent",
        color: "#F4F4F8",
      };
    case "today":
      return {
        borderColor: "#22D3EE",
        borderStyle: "solid",
        backgroundColor: "rgba(34,211,238,0.12)",
        color: "#F4F4F8",
      };
    default:
      return {
        borderColor: "#3A4055",
        borderStyle: "dashed",
        backgroundColor: "transparent",
        color: NEUTRAL_HEX.text3,
      };
  }
}

export function FuelLogHeaderPresenter({
  section,
  onSection,
  dayLabel,
  week,
  onSelectDay,
  onOpenCalendar,
  onOpenTargets,
  onNew,
  testID = "fuel-log-header",
}: FuelLogHeaderProps) {
  const isLog = section === "log";
  const sections: { key: FuelSection; label: string }[] = [
    { key: "log", label: "Log" },
    { key: "plan", label: "Plan" },
    { key: "meals", label: "Meals" },
  ];
  return (
    <View testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <Text
          fontFamily="$display"
          fontSize={34}
          lineHeight={40}
          fontWeight="800"
          letterSpacing={-1}
          color="$text"
          accessibilityRole="header"
        >
          Fuel
        </Text>
        <View flexDirection="row" gap={8}>
          {isLog ? (
            <RoundBtn
              label="Pick a day"
              onPress={onOpenCalendar}
              testID="fuel-open-calendar"
            >
              <IconCalendar size={20} color="#F4F4F8" />
            </RoundBtn>
          ) : null}
          {section === "meals" ? (
            <RoundBtn
              label="New meal or recipe"
              onPress={onNew ?? (() => {})}
              testID="fuel-new-meal"
            >
              <IconPlus size={20} color="#F4F4F8" />
            </RoundBtn>
          ) : (
            <RoundBtn
              label="Edit nutrition targets"
              onPress={onOpenTargets}
              testID="fuel-open-targets"
            >
              <IconTarget size={20} color="#F4F4F8" />
            </RoundBtn>
          )}
        </View>
      </View>

      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        marginTop={14}
      >
        <View
          flexDirection="row"
          gap={2}
          padding={3}
          borderRadius={9999}
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border"
          accessibilityRole="tablist"
          accessibilityLabel="Fuel sections"
        >
          {sections.map((s) => {
            const on = s.key === section;
            return (
              <Pressable
                key={s.key}
                onPress={() => onSection(s.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                testID={`fuel-section-${s.key}`}
              >
                <View
                  height={36}
                  paddingHorizontal={16}
                  borderRadius={9999}
                  justifyContent="center"
                  backgroundColor={on ? "$surface4" : "transparent"}
                >
                  <Text
                    fontFamily="$body"
                    fontSize={14}
                    fontWeight="600"
                    color={on ? "$text" : "$text3"}
                  >
                    {s.label}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>
        {isLog ? (
          <Text
            fontFamily="$mono"
            fontSize={12}
            color="$text3"
            testID="fuel-day-label"
          >
            {dayLabel}
          </Text>
        ) : null}
      </View>

      {isLog ? (
        <View
          flexDirection="row"
          marginTop={16}
          accessibilityRole="tablist"
          accessibilityLabel="Days this week"
          testID="fuel-week"
        >
          {week.map((d) => {
            const st = dotStyle(d.state);
            const disabled = d.state === "future";
            return (
              <Pressable
                key={d.iso}
                style={{ flex: 1 }}
                onPress={disabled ? undefined : () => onSelectDay(d.iso)}
                disabled={disabled}
                accessibilityRole="tab"
                accessibilityState={{ selected: d.selected, disabled }}
                accessibilityLabel={`${d.dayName} ${d.dayNum}, ${STATE_WORDS[d.state]}`}
                testID={`fuel-week-${d.iso}`}
              >
                <View
                  alignItems="center"
                  gap={6}
                  paddingVertical={6}
                  borderRadius={14}
                  backgroundColor={d.selected ? "$surface" : "transparent"}
                >
                  <Text fontFamily="$body" fontSize={11} color="$text3">
                    {d.dayName}
                  </Text>
                  <View
                    width={36}
                    height={36}
                    borderRadius={9999}
                    borderWidth={2}
                    borderColor={st.borderColor}
                    borderStyle={st.borderStyle}
                    backgroundColor={st.backgroundColor}
                    alignItems="center"
                    justifyContent="center"
                  >
                    <Text
                      fontFamily="$mono"
                      fontSize={13}
                      fontWeight="600"
                      color={st.color}
                    >
                      {d.dayNum}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}
    </View>
  );
}
