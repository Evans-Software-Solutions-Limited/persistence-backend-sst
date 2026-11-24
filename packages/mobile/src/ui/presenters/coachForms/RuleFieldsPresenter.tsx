import { useEffect, useState, type ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import {
  IconBell,
  IconChevronD,
  IconMinus,
  IconPlus,
  IconX,
} from "@/ui/components/icons";
import {
  MAX_REMINDERS,
  type FormTrigger,
  type RuleFields,
} from "@/domain/models/coachForms";
import {
  clampDueHours,
  clampReminderHours,
  formatMinutes,
  hoursFromMoment,
  momentFromHours,
  momentLabel,
  normaliseReminders,
  parseTime,
  type RuleTiming,
} from "@/domain/services/coachForms.service";
import {
  DayChips,
  FieldButton,
  FieldInput,
  FieldLabel,
  LinkButton,
  SegRow,
} from "./kit";

/**
 * C10h / C10j rule fields: day (weekly), time (weekly/daily), due and
 * reminders. Due and reminders show as a day and time for weekly/daily rules
 * ("Mon 12:00", "Sunday 18:00 if not done") and as "N hours/days after it's
 * sent" otherwise; they're stored as whole hours from the send (BRIEF).
 */
export type RuleFieldsPresenterProps = {
  trigger: FormTrigger;
  rule: RuleFields;
  onChange: (rule: RuleFields) => void;
  testID?: string;
};

type Editing = { kind: "due" } | { kind: "reminder"; index: number } | null;

export function RuleFieldsPresenter(p: RuleFieldsPresenterProps) {
  const id = p.testID ?? "rule";
  const timing: RuleTiming = {
    trigger: p.trigger,
    weekday: p.rule.weekday,
    timeLocal: p.rule.timeLocal,
  };
  const timed = p.trigger === "weekly" || p.trigger === "daily";
  const [editing, setEditing] = useState<Editing>(null);
  const [timeText, setTimeText] = useState(p.rule.timeLocal ?? "");
  useEffect(() => setTimeText(p.rule.timeLocal ?? ""), [p.rule.timeLocal]);

  const set = (patch: Partial<RuleFields>) =>
    p.onChange({ ...p.rule, ...patch });
  const dueLabel =
    p.rule.dueAfterHours === null
      ? "No due date"
      : momentLabel(timing, p.rule.dueAfterHours);

  const onTime = (text: string) => {
    setTimeText(text);
    if (parseTime(text) !== null && /^\d{2}:\d{2}$/.test(text)) {
      set({ timeLocal: text });
    }
  };

  const addReminder = () => {
    if (p.rule.reminders.length >= MAX_REMINDERS) return;
    const last = p.rule.reminders.at(-1)?.afterHours ?? 0;
    const base = p.rule.dueAfterHours ?? 24;
    let hours = last > 0 ? last + 12 : Math.max(1, base - 3);
    while (p.rule.reminders.some((r) => r.afterHours === hours)) hours += 1;
    const reminders = normaliseReminders([
      ...p.rule.reminders,
      { afterHours: hours },
    ]);
    set({ reminders });
    setEditing({
      kind: "reminder",
      index: reminders.findIndex(
        (r) => r.afterHours === clampReminderHours(hours),
      ),
    });
  };

  return (
    <View testID={id}>
      {p.trigger === "weekly" ? (
        <View marginTop={10}>
          <DayChips
            value={p.rule.weekday}
            onChange={(weekday) => set({ weekday })}
            testID={`${id}-day`}
          />
        </View>
      ) : null}
      <View flexDirection="row" gap={8} marginTop={10}>
        {timed ? (
          <View flex={1}>
            <FieldLabel top={0}>Time</FieldLabel>
            <FieldInput
              value={timeText}
              onChangeText={onTime}
              placeholder="09:00"
              accessibilityLabel="Time"
              keyboardType="numbers-and-punctuation"
              maxLength={5}
              testID={`${id}-time`}
            />
          </View>
        ) : null}
        <View flex={1}>
          <FieldLabel top={0}>Due</FieldLabel>
          <FieldButton
            onPress={() =>
              setEditing(editing?.kind === "due" ? null : { kind: "due" })
            }
            accessibilityLabel={`Due: ${dueLabel}`}
            trailing={<IconChevronD size={16} color="#8A8A98" />}
            testID={`${id}-due`}
          >
            {dueLabel}
          </FieldButton>
        </View>
      </View>
      {editing?.kind === "due" ? (
        <MomentEditor
          timing={timing}
          hours={p.rule.dueAfterHours}
          clamp={clampDueHours}
          onHours={(h) => set({ dueAfterHours: h })}
          onClear={() => {
            set({ dueAfterHours: null });
            setEditing(null);
          }}
          onDone={() => setEditing(null)}
          testID={`${id}-due-editor`}
        />
      ) : null}

      <FieldLabel>Reminders</FieldLabel>
      {p.rule.reminders.map((r, index) => {
        const label = momentLabel(timing, r.afterHours, { long: true });
        const open = editing?.kind === "reminder" && editing.index === index;
        return (
          <View key={`${r.afterHours}`}>
            <View
              flexDirection="row"
              alignItems="center"
              gap={10}
              paddingVertical={4}
              borderBottomWidth={1}
              borderBottomColor="$border"
            >
              <IconBell size={16} color="#8A8A98" />
              <Pressable
                style={{ flex: 1 }}
                onPress={() =>
                  setEditing(open ? null : { kind: "reminder", index })
                }
                accessibilityRole="button"
                accessibilityLabel={`Reminder ${label}`}
                testID={`${id}-reminder-${index}`}
              >
                <View flexDirection="row" alignItems="center" gap={10}>
                  <Text
                    flex={1}
                    fontFamily="$body"
                    fontWeight="500"
                    fontSize={14}
                    color="$text"
                  >
                    {label}
                  </Text>
                  <Text fontFamily="$body" fontSize={12} color="$text3">
                    if not done
                  </Text>
                </View>
              </Pressable>
              <Pressable
                onPress={() => {
                  set({
                    reminders: p.rule.reminders.filter((_, i) => i !== index),
                  });
                  setEditing(null);
                }}
                accessibilityRole="button"
                accessibilityLabel={`Remove reminder ${label}`}
                testID={`${id}-reminder-${index}-remove`}
                style={{
                  width: 40,
                  height: 40,
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <IconX size={16} color="#8A8A98" />
              </Pressable>
            </View>
            {open ? (
              <MomentEditor
                timing={timing}
                hours={r.afterHours}
                clamp={clampReminderHours}
                onHours={(h) => {
                  const next = p.rule.reminders.map((x, i) =>
                    i === index ? { afterHours: h } : x,
                  );
                  const reminders = normaliseReminders(next);
                  set({ reminders });
                  setEditing({
                    kind: "reminder",
                    index: reminders.findIndex(
                      (x) => x.afterHours === clampReminderHours(h),
                    ),
                  });
                }}
                onDone={() => setEditing(null)}
                testID={`${id}-reminder-editor`}
              />
            ) : null}
          </View>
        );
      })}
      <LinkButton
        onPress={addReminder}
        disabled={p.rule.reminders.length >= MAX_REMINDERS}
        testID={`${id}-add-reminder`}
      >
        + Add reminder
      </LinkButton>
    </View>
  );
}

/**
 * Inline editor for a due time or reminder. Weekly: day chips + hour;
 * daily: same/next day + hour; otherwise a number of hours or days.
 */
function MomentEditor(p: {
  timing: RuleTiming;
  hours: number | null;
  clamp: (h: number) => number;
  onHours: (hours: number) => void;
  onClear?: () => void;
  onDone: () => void;
  testID: string;
}) {
  const start = p.hours ?? 24;
  // The unit the coach picked; it starts from what the value reads as.
  const [inDays, setInDays] = useState(start % 24 === 0);
  const moment = momentFromHours(p.timing, start);

  const commit = (hours: number | null) => {
    if (hours !== null) p.onHours(p.clamp(hours));
  };

  let body;
  if (moment !== null) {
    const shiftHour = (delta: number) =>
      commit(
        hoursFromMoment(p.timing, {
          day: moment.day,
          minutes: (moment.minutes + delta * 60 + 1440) % 1440,
        }),
      );
    body = (
      <View gap={10}>
        {p.timing.trigger === "weekly" ? (
          <DayChips
            value={moment.day}
            onChange={(day) =>
              commit(
                hoursFromMoment(p.timing, { day, minutes: moment.minutes }),
              )
            }
            testID={`${p.testID}-day`}
          />
        ) : (
          <SegRow
            label="Day"
            options={[
              { value: "0", label: "Same day" },
              { value: "1", label: "Next day" },
            ]}
            value={moment.day >= 1 ? "1" : "0"}
            onChange={(v) =>
              commit(
                hoursFromMoment(p.timing, {
                  day: Number(v),
                  minutes: moment.minutes,
                }),
              )
            }
            testID={`${p.testID}-dayoffset`}
          />
        )}
        <Stepper
          label={formatMinutes(moment.minutes)}
          onMinus={() => shiftHour(-1)}
          onPlus={() => shiftHour(1)}
          testID={`${p.testID}-hour`}
        />
      </View>
    );
  } else {
    const days = inDays && start % 24 === 0;
    const n = days ? start / 24 : start;
    const unit = days ? 24 : 1;
    body = (
      <View gap={10}>
        <SegRow
          label="Unit"
          options={[
            { value: "hours", label: "Hours" },
            { value: "days", label: "Days" },
          ]}
          value={days ? "days" : "hours"}
          onChange={(v) => {
            setInDays(v === "days");
            commit(
              v === "days" ? Math.max(1, Math.round(start / 24)) * 24 : start,
            );
          }}
          testID={`${p.testID}-unit`}
        />
        <Stepper
          label={`${n} ${days ? (n === 1 ? "day" : "days") : n === 1 ? "hour" : "hours"}`}
          onMinus={() => commit(Math.max(unit, start - unit))}
          onPlus={() => commit(start + unit)}
          testID={`${p.testID}-amount`}
        />
      </View>
    );
  }

  return (
    <View
      marginTop={8}
      padding={12}
      borderRadius={12}
      backgroundColor="$surface2"
      borderWidth={1}
      borderColor="$border2"
      gap={6}
      testID={p.testID}
    >
      {body}
      <View flexDirection="row" justifyContent="space-between">
        {p.onClear ? (
          <LinkButton onPress={p.onClear} testID={`${p.testID}-clear`}>
            No due date
          </LinkButton>
        ) : (
          <View />
        )}
        <LinkButton onPress={p.onDone} testID={`${p.testID}-done`}>
          Done
        </LinkButton>
      </View>
    </View>
  );
}

function Stepper(p: {
  label: string;
  onMinus: () => void;
  onPlus: () => void;
  testID: string;
}) {
  const btn = (icon: ReactNode, onPress: () => void, name: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={name}
      testID={`${p.testID}-${name === "Earlier" ? "minus" : "plus"}`}
    >
      <View
        width={44}
        height={44}
        borderRadius={9999}
        alignItems="center"
        justifyContent="center"
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$border2"
      >
        {icon}
      </View>
    </Pressable>
  );
  return (
    <View flexDirection="row" alignItems="center" gap={12} testID={p.testID}>
      {btn(<IconMinus size={16} color="#C2C2CE" />, p.onMinus, "Earlier")}
      <Text
        flex={1}
        textAlign="center"
        fontFamily="$mono"
        fontWeight="600"
        fontSize={16}
        color="$text"
        testID={`${p.testID}-value`}
      >
        {p.label}
      </Text>
      {btn(<IconPlus size={16} color="#C2C2CE" />, p.onPlus, "Later")}
    </View>
  );
}
