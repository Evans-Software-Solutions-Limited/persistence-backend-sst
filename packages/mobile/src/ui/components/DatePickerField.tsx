import { useEffect, useMemo, useState } from "react";
import { Modal, Platform, Pressable } from "react-native";
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from "@react-native-community/datetimepicker";
import { Text, View } from "@tamagui/core";

import {
  IconCalendar,
  IconChevronL,
  IconChevronR,
  IconX,
} from "@/ui/components/icons";
import { IconBtn } from "@/ui/components/foundation";
import { NEUTRAL_HEX, toneHex } from "@/ui/components/foundation/tones";

const WEEKDAY_LETTERS = ["M", "T", "W", "T", "F", "S", "S"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

type CalendarMode = "days" | "months" | "years";

function validIsoDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function todayIso(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function firstOfMonthISO(dayIso: string): string {
  return `${dayIso.slice(0, 7)}-01`;
}

function addMonthsISO(monthIso: string, delta: number): string {
  const [year, month] = monthIso.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + delta, 1));
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function monthGrid(monthIso: string): (string | null)[] {
  const [year, month] = monthIso.split("-").map(Number);
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const leading = (firstWeekday + 6) % 7;
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const cells: (string | null)[] = new Array(leading).fill(null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push(
      `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
    );
  }
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function formatDisplayDate(value: string, locale?: string): string {
  if (!validIsoDay(value)) return "Select date";
  return new Date(`${value}T00:00:00.000Z`).toLocaleDateString(locale, {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function nativeDate(value: string, fallback: string): Date {
  const day = validIsoDay(value) ? value : fallback;
  const [year, month, date] = day.split("-").map(Number);
  // Noon avoids a daylight-saving boundary changing the selected calendar day.
  return new Date(year, month - 1, date, 12);
}

function nativeDateToIso(value: Date): string {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
}

export type DateCalendarModalProps = {
  visible: boolean;
  selectedDate: string;
  onSelectDate: (dayIso: string) => void;
  onClose: () => void;
  minimumDate?: string;
  maximumDate?: string;
  allowClear?: boolean;
  onClear?: () => void;
  label?: string;
  testID?: string;
};

/** Shared, JS-only date calendar extracted from Fuel. Month and year labels are
 * direct selectors, avoiding hundreds of swipes for dates of birth. */
export function DateCalendarModal({
  visible,
  selectedDate,
  onSelectDate,
  onClose,
  minimumDate,
  maximumDate,
  allowClear = false,
  onClear,
  label = "Choose date",
  testID = "date-calendar-modal",
}: DateCalendarModalProps) {
  const anchor = validIsoDay(selectedDate)
    ? selectedDate
    : maximumDate && validIsoDay(maximumDate)
      ? maximumDate
      : todayIso();
  const [viewMonth, setViewMonth] = useState(() => firstOfMonthISO(anchor));
  const [mode, setMode] = useState<CalendarMode>("days");

  useEffect(() => {
    if (!visible) return;
    setViewMonth(firstOfMonthISO(anchor));
    setMode("days");
  }, [visible, anchor]);

  const cells = useMemo(() => monthGrid(viewMonth), [viewMonth]);
  const viewYear = Number(viewMonth.slice(0, 4));
  const viewMonthNumber = Number(viewMonth.slice(5, 7));
  const yearBlockStart = Math.floor(viewYear / 12) * 12;
  const minMonth = minimumDate ? firstOfMonthISO(minimumDate) : null;
  const maxMonth = maximumDate ? firstOfMonthISO(maximumDate) : null;
  const canGoPrevious = minMonth === null || viewMonth > minMonth;
  const canGoNext = maxMonth === null || viewMonth < maxMonth;

  const move = (delta: number) => {
    if (mode === "years") {
      setViewMonth((current) => addMonthsISO(current, delta * 12 * 12));
    } else if (mode === "months") {
      setViewMonth((current) => addMonthsISO(current, delta * 12));
    } else {
      setViewMonth((current) => addMonthsISO(current, delta));
    }
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      testID={testID}
    >
      <Pressable
        onPress={onClose}
        accessibilityLabel="Dismiss the date picker"
        style={{
          flex: 1,
          backgroundColor: "rgba(0,0,0,0.7)",
          alignItems: "center",
          justifyContent: "center",
          padding: 24,
        }}
        testID={`${testID}-backdrop`}
      >
        <Pressable
          onPress={() => undefined}
          style={{ width: "100%", maxWidth: 340 }}
        >
          <View
            backgroundColor="$surface"
            borderColor="$border2"
            borderWidth={1}
            borderRadius={20}
            padding={20}
          >
            <Text
              fontFamily="$display"
              fontSize={11}
              fontWeight="600"
              letterSpacing={1.2}
              textTransform="uppercase"
              color="$text3"
              marginBottom={10}
              accessibilityRole="header"
            >
              {label}
            </Text>
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              marginBottom={16}
            >
              <IconBtn
                icon={<IconChevronL size={16} />}
                tone="ghost"
                size={32}
                disabled={mode === "days" && !canGoPrevious}
                onPress={() => move(-1)}
                testID={`${testID}-prev-month`}
                accessibilityLabel={
                  mode === "years"
                    ? "Previous twelve years"
                    : mode === "months"
                      ? "Previous year"
                      : "Previous month"
                }
              />
              <View flexDirection="row" alignItems="center" gap={4}>
                <Pressable
                  onPress={() => setMode("months")}
                  accessibilityRole="button"
                  accessibilityLabel="Choose month"
                  testID={`${testID}-month-selector`}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="700"
                    fontSize={15}
                    color="$text"
                  >
                    {MONTHS[viewMonthNumber - 1]}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => setMode("years")}
                  accessibilityRole="button"
                  accessibilityLabel="Choose year"
                  testID={`${testID}-year-selector`}
                >
                  <Text
                    fontFamily="$display"
                    fontWeight="700"
                    fontSize={15}
                    color="$primary"
                    testID={`${testID}-month-label`}
                  >
                    {mode === "years"
                      ? `${yearBlockStart}–${yearBlockStart + 11}`
                      : viewYear}
                  </Text>
                </Pressable>
              </View>
              <IconBtn
                icon={<IconChevronR size={16} />}
                tone="ghost"
                size={32}
                disabled={mode === "days" && !canGoNext}
                onPress={() => move(1)}
                testID={`${testID}-next-month`}
                accessibilityLabel={
                  mode === "years"
                    ? "Next twelve years"
                    : mode === "months"
                      ? "Next year"
                      : "Next month"
                }
              />
              <View position="absolute" top={-4} right={-4}>
                <IconBtn
                  icon={<IconX size={16} />}
                  tone="ghost"
                  size={28}
                  onPress={onClose}
                  testID={`${testID}-close`}
                  accessibilityLabel="Close"
                />
              </View>
            </View>

            {mode === "years" ? (
              <View flexDirection="row" flexWrap="wrap">
                {Array.from(
                  { length: 12 },
                  (_, index) => yearBlockStart + index,
                ).map((year) => {
                  const disabled =
                    (minimumDate
                      ? year < Number(minimumDate.slice(0, 4))
                      : false) ||
                    (maximumDate
                      ? year > Number(maximumDate.slice(0, 4))
                      : false);
                  return (
                    <Pressable
                      key={year}
                      disabled={disabled}
                      onPress={() => {
                        setViewMonth(
                          `${year}-${String(viewMonthNumber).padStart(2, "0")}-01`,
                        );
                        setMode("months");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={String(year)}
                      accessibilityState={{
                        disabled,
                        selected: year === viewYear,
                      }}
                      testID={`${testID}-year-${year}`}
                      style={{
                        width: "33.333%",
                        paddingVertical: 12,
                        alignItems: "center",
                        opacity: disabled ? 0.3 : 1,
                      }}
                    >
                      <Text
                        color={year === viewYear ? "$primary" : "$text2"}
                        fontWeight={year === viewYear ? "700" : "500"}
                      >
                        {year}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : mode === "months" ? (
              <View flexDirection="row" flexWrap="wrap">
                {MONTHS.map((month, index) => {
                  const monthIso = `${viewYear}-${String(index + 1).padStart(2, "0")}-01`;
                  const disabled =
                    (minMonth !== null && monthIso < minMonth) ||
                    (maxMonth !== null && monthIso > maxMonth);
                  return (
                    <Pressable
                      key={month}
                      disabled={disabled}
                      onPress={() => {
                        setViewMonth(monthIso);
                        setMode("days");
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${month} ${viewYear}`}
                      accessibilityState={{
                        disabled,
                        selected: index + 1 === viewMonthNumber,
                      }}
                      testID={`${testID}-month-${index + 1}`}
                      style={{
                        width: "33.333%",
                        paddingVertical: 12,
                        alignItems: "center",
                        opacity: disabled ? 0.3 : 1,
                      }}
                    >
                      <Text
                        color={
                          index + 1 === viewMonthNumber ? "$primary" : "$text2"
                        }
                        fontWeight={
                          index + 1 === viewMonthNumber ? "700" : "500"
                        }
                      >
                        {month.slice(0, 3)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : (
              <>
                <View flexDirection="row" marginBottom={6}>
                  {WEEKDAY_LETTERS.map((letter, index) => (
                    <View
                      key={`weekday-${index}`}
                      width={`${100 / 7}%`}
                      alignItems="center"
                    >
                      <Text fontSize={11} fontWeight="600" color="$text3">
                        {letter}
                      </Text>
                    </View>
                  ))}
                </View>
                <View flexDirection="row" flexWrap="wrap">
                  {cells.map((iso, index) => {
                    if (iso === null) {
                      return (
                        <View
                          key={`blank-${index}`}
                          width={`${100 / 7}%`}
                          height={36}
                        />
                      );
                    }
                    const disabled =
                      (minimumDate !== undefined && iso < minimumDate) ||
                      (maximumDate !== undefined && iso > maximumDate);
                    const selected = iso === selectedDate;
                    const isToday = iso === todayIso();
                    return (
                      <View
                        key={iso}
                        width={`${100 / 7}%`}
                        height={36}
                        alignItems="center"
                        justifyContent="center"
                      >
                        <Pressable
                          disabled={disabled}
                          onPress={() => onSelectDate(iso)}
                          testID={`${testID}-day-${iso}`}
                          accessibilityRole="button"
                          accessibilityLabel={formatDisplayDate(iso)}
                          accessibilityState={{ disabled, selected }}
                          style={{
                            width: 30,
                            height: 30,
                            borderRadius: 15,
                            alignItems: "center",
                            justifyContent: "center",
                            backgroundColor: selected
                              ? NEUTRAL_HEX.primary
                              : "transparent",
                            borderWidth: isToday && !selected ? 1 : 0,
                            borderColor: NEUTRAL_HEX.primary,
                            opacity: disabled ? 0.3 : 1,
                          }}
                        >
                          <Text
                            fontSize={13}
                            fontWeight={selected ? "700" : "500"}
                            color={selected ? toneHex("primary").ink : "$text"}
                          >
                            {Number(iso.slice(8, 10))}
                          </Text>
                        </Pressable>
                      </View>
                    );
                  })}
                </View>
              </>
            )}

            {allowClear ? (
              <Pressable
                onPress={() => {
                  onClear?.();
                  onClose();
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear selected date"
                testID={`${testID}-clear`}
                style={{
                  minHeight: 44,
                  justifyContent: "center",
                  alignItems: "center",
                  marginTop: 8,
                }}
              >
                <Text color="$primary" fontWeight="600">
                  Clear date
                </Text>
              </Pressable>
            ) : null}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export type DatePickerFieldProps = {
  label: string;
  value: string;
  onChange: (value: string) => void;
  minimumDate?: string;
  maximumDate?: string;
  allowClear?: boolean;
  disabled?: boolean;
  helperText?: string;
  locale?: string;
  testID?: string;
};

export function DatePickerField({
  label,
  value,
  onChange,
  minimumDate,
  maximumDate,
  allowClear = true,
  disabled = false,
  helperText,
  locale,
  testID = "date-picker-field",
}: DatePickerFieldProps) {
  const [open, setOpen] = useState(false);
  const display = formatDisplayDate(value, locale);
  const fallback =
    maximumDate && validIsoDay(maximumDate) ? maximumDate : todayIso();
  const selected = nativeDate(value, fallback);
  const minimum =
    minimumDate && validIsoDay(minimumDate)
      ? nativeDate(minimumDate, fallback)
      : undefined;
  const maximum =
    maximumDate && validIsoDay(maximumDate)
      ? nativeDate(maximumDate, fallback)
      : undefined;

  const handleNativeChange = (event: DateTimePickerEvent, nextDate?: Date) => {
    if (event.type === "set" && nextDate) onChange(nativeDateToIso(nextDate));
  };

  const openAndroidPicker = () => {
    DateTimePickerAndroid.open({
      value: selected,
      mode: "date",
      display: "default",
      minimumDate: minimum,
      maximumDate: maximum,
      onChange: handleNativeChange,
    });
  };

  if (Platform.OS === "ios") {
    return (
      <>
        <View
          minHeight={40}
          flexDirection="row"
          alignItems="center"
          justifyContent="flex-start"
          opacity={disabled ? 0.5 : 1}
          accessibilityLabel={`${label}, ${value ? `selected ${display}` : "not selected"}`}
          accessibilityState={{ disabled }}
          testID={testID}
        >
          <DateTimePicker
            value={selected}
            mode="date"
            display="compact"
            minimumDate={minimum}
            maximumDate={maximum}
            disabled={disabled}
            locale={locale}
            themeVariant="dark"
            accentColor={toneHex("primary").base}
            onChange={handleNativeChange}
            testID={`${testID}-native`}
          />
        </View>
        {allowClear && value ? (
          <Pressable
            onPress={() => onChange("")}
            disabled={disabled}
            accessibilityRole="button"
            accessibilityLabel={`Clear ${label.toLowerCase()}`}
            testID={`${testID}-clear`}
          >
            <Text color="$primary" fontSize={12} marginTop={6}>
              Clear date
            </Text>
          </Pressable>
        ) : null}
        {helperText ? (
          <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={4}>
            {helperText}
          </Text>
        ) : null}
      </>
    );
  }

  return (
    <>
      <Pressable
        onPress={() =>
          Platform.OS === "android" ? openAndroidPicker() : setOpen(true)
        }
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={`${label}, ${value ? `selected ${display}` : "not selected"}`}
        accessibilityHint="Opens a calendar"
        accessibilityState={{ disabled }}
        testID={testID}
        style={({ pressed }) => ({
          opacity: disabled ? 0.5 : pressed ? 0.8 : 1,
        })}
      >
        <View
          minHeight={48}
          paddingHorizontal={14}
          borderRadius={12}
          borderWidth={1}
          borderColor="$border"
          backgroundColor="$surface2"
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <Text
            fontFamily="$body"
            fontSize={15}
            color={value ? "$text" : "$text3"}
          >
            {display}
          </Text>
          <IconCalendar size={18} color={NEUTRAL_HEX.text3} />
        </View>
      </Pressable>
      {Platform.OS === "android" && allowClear && value ? (
        <Pressable
          onPress={() => onChange("")}
          disabled={disabled}
          accessibilityRole="button"
          accessibilityLabel={`Clear ${label.toLowerCase()}`}
          testID={`${testID}-clear`}
        >
          <Text color="$primary" fontSize={12} marginTop={6}>
            Clear date
          </Text>
        </Pressable>
      ) : null}
      {helperText ? (
        <Text fontFamily="$body" fontSize={11} color="$text3" marginTop={4}>
          {helperText}
        </Text>
      ) : null}
      {Platform.OS === "web" ? (
        <DateCalendarModal
          visible={open}
          selectedDate={value}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
          allowClear={allowClear && value.length > 0}
          onClear={() => onChange("")}
          onSelectDate={(iso) => {
            onChange(iso);
            setOpen(false);
          }}
          onClose={() => setOpen(false)}
          label={label}
          testID={`${testID}-calendar`}
        />
      ) : null}
    </>
  );
}
