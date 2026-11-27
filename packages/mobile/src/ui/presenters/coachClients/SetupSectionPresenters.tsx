import { useState, type ReactNode } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconClipboard, IconGrip, IconX } from "@/ui/components/icons";
import { ReorderableList } from "@/ui/components/workouts/ReorderableList";
import { ExerciseReorderHandle } from "@/ui/components/workouts/ExerciseReorderHandle";
import type {
  SetupItem,
  SetupMealPlan,
  SetupResource,
} from "@/domain/models/coachClientProfiles";
import type {
  CoachForm,
  FormSchedule,
  RuleFields,
} from "@/domain/models/coachForms";
import type {
  ProgramSummary,
  ProgramWorkoutEntry,
} from "@/domain/models/program";
import {
  WEEKDAYS_LONG,
  WEEKDAYS_SHORT,
  plural,
  questionCount,
} from "@/domain/services/coachForms.service";
import {
  formMeta,
  formatKcal,
  overrideFrom,
  planMeta,
  programmeMeta,
  renumber,
  resourceKind,
  ruleFor,
  targetNumbers,
  welcomeText,
} from "@/domain/services/coachClientProfiles.service";
import {
  FieldInput,
  FieldLabel,
  LinkButton,
  SegRow,
} from "@/ui/presenters/coachForms/kit";
import { RuleFieldsPresenter } from "@/ui/presenters/coachForms/RuleFieldsPresenter";
import {
  ErrorLine,
  LibraryPicker,
  PageSub,
  PageTitle,
  QuestionsToggle,
  SavesHint,
  TopBar,
  UpdatedElsewhere,
} from "./kit";

/**
 * C11l–r — one page per set-up section. "Set up" (back) saves, Cancel drops
 * the page's changes. Each body is pure: it takes the section's items and
 * reports a new list; the container's react-hook-form decides when that
 * becomes a save.
 */

export function SectionPage(p: {
  title: string;
  sub: string;
  backLabel: string;
  error: string | null;
  conflict: boolean;
  onBack: () => void;
  onCancel: () => void;
  onDismissConflict: () => void;
  children: ReactNode;
  testID: string;
}) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View flex={1} paddingTop={insets.top} testID={p.testID}>
        <TopBar
          backLabel={p.backLabel}
          onBack={p.onBack}
          right={{
            label: "Cancel",
            onPress: p.onCancel,
            testID: "section-cancel",
          }}
          testID="section"
        />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <PageTitle size={26}>{p.title}</PageTitle>
          <PageSub>{p.sub}</PageSub>
          {p.conflict ? (
            <UpdatedElsewhere
              onDismiss={p.onDismissConflict}
              testID="section-conflict"
            />
          ) : null}
          {p.children}
          {p.error ? (
            <ErrorLine testID="section-error">{p.error}</ErrorLine>
          ) : null}
        </ScrollView>
        <View paddingTop={8} paddingBottom={Math.max(insets.bottom, 16) + 8}>
          <SavesHint />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

type BodyBase = {
  items: SetupItem[];
  onChange: (items: SetupItem[]) => void;
  clientFirst: string;
};

const without = (items: SetupItem[], index: number) =>
  renumber(items.filter((_, i) => i !== index));

const withAdded = (items: SetupItem[], refId: string) =>
  renumber([...items, { refId, config: {}, sortOrder: items.length }]);

function RemoveButton(p: {
  label: string;
  onPress: () => void;
  testID: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Remove ${p.label}`}
      testID={p.testID}
      style={{
        width: 40,
        height: 40,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <IconX size={18} color="#FCA5A5" />
    </Pressable>
  );
}

function Block(p: { children: ReactNode; testID?: string }) {
  return (
    <View
      borderTopWidth={1}
      borderTopColor="$border2"
      paddingTop={12}
      paddingBottom={6}
      testID={p.testID}
    >
      {p.children}
    </View>
  );
}

function BlockHead(p: {
  title: string;
  sub: string;
  leading?: ReactNode;
  trailing?: ReactNode;
}) {
  return (
    <View flexDirection="row" alignItems="center" gap={10}>
      {p.leading}
      <View flex={1} minWidth={0}>
        <Text fontFamily="$body" fontWeight="600" fontSize={15} color="$text">
          {p.title}
        </Text>
        <Text fontFamily="$body" fontSize={12.5} color="$text3">
          {p.sub}
        </Text>
      </View>
      {p.trailing}
    </View>
  );
}

// ── C11l Starter forms ───────────────────────────────────────────────────────

const REORDER_ROW = 56;

export function StarterFormsBody(
  p: BodyBase & { forms: readonly CoachForm[]; libraryLoading: boolean },
) {
  const [reordering, setReordering] = useState(false);
  const byId = new Map(p.forms.map((f) => [f.id, f]));
  const chosen = new Set(p.items.map((i) => i.refId));
  const available = p.forms.filter((f) => !chosen.has(f.id) && !f.archivedAt);
  const title = (item: SetupItem) =>
    byId.get(item.refId ?? "")?.title ?? "Form";
  const move = (index: number, delta: -1 | 1) => {
    const to = index + delta;
    if (to < 0 || to >= p.items.length) return;
    const next = [...p.items];
    const [moved] = next.splice(index, 1);
    next.splice(to, 0, moved!);
    p.onChange(renumber(next));
  };

  if (reordering) {
    return (
      <View testID="starter-reorder">
        <ReorderableList
          testID="starter-reorder-list"
          rowHeight={REORDER_ROW}
          data={p.items.map((item, i) => ({ id: item.refId ?? `i${i}`, item }))}
          onReorder={(_moved, _to, orderedIds) => {
            const byRef = new Map(p.items.map((i) => [i.refId ?? "", i]));
            p.onChange(
              renumber(
                orderedIds
                  .map((id) => byRef.get(id))
                  .filter((i): i is SetupItem => !!i),
              ),
            );
          }}
          renderRow={({ item }, { index, wrapHandle }) => (
            <View
              height={REORDER_ROW}
              flexDirection="row"
              alignItems="center"
              gap={8}
              borderBottomWidth={1}
              borderColor="$border"
            >
              {wrapHandle(
                <ExerciseReorderHandle
                  label={title(item)}
                  position={index + 1}
                  total={p.items.length}
                  onMove={(d) => move(index, d)}
                  draggable
                />,
              )}
              <Text
                flex={1}
                fontFamily="$body"
                fontWeight="600"
                fontSize={15}
                color="$text"
              >
                {title(item)}
              </Text>
            </View>
          )}
        />
        <LinkButton
          onPress={() => setReordering(false)}
          testID="starter-reorder-done"
        >
          Done
        </LinkButton>
      </View>
    );
  }

  return (
    <View testID="starter-forms">
      {p.items.map((item, index) => {
        const form = byId.get(item.refId ?? "");
        return (
          <Block key={item.refId ?? index} testID={`starter-${item.refId}`}>
            <BlockHead
              title={title(item)}
              sub={formMeta(form)}
              leading={<IconGrip size={16} color="#8A8A98" />}
              trailing={
                <RemoveButton
                  label={title(item)}
                  onPress={() => p.onChange(without(p.items, index))}
                  testID={`starter-remove-${item.refId}`}
                />
              }
            />
            <QuestionsToggle
              questions={form?.version?.questions ?? []}
              testID={`starter-questions-${item.refId}`}
            />
          </Block>
        );
      })}
      {p.items.length > 1 ? (
        <LinkButton
          onPress={() => setReordering(true)}
          testID="starter-reorder-open"
        >
          Reorder
        </LinkButton>
      ) : null}
      <LibraryPicker
        label="Add a form from your Library"
        empty="No forms in your Library yet."
        loading={p.libraryLoading}
        rows={available.map((f) => ({
          id: f.id,
          title: f.title,
          sub: formMeta(f),
        }))}
        onAdd={(id) => p.onChange(withAdded(p.items, id))}
        testID="starter-picker"
      />
    </View>
  );
}

// ── C11m Repeating check-ins ─────────────────────────────────────────────────

const REPEATING = new Set(["once", "weekly", "daily"]);

export function checkinsSub(
  items: readonly SetupItem[],
  schedules: ReadonlyMap<string, FormSchedule>,
  clientFirst: string,
): string {
  const first = items[0]?.refId ? schedules.get(items[0].refId) : undefined;
  const rule = first ? ruleFor(first, items[0]!.config.override) : null;
  const starts =
    rule?.trigger === "weekly" && rule.weekday
      ? `Starts the first ${WEEKDAYS_LONG[rule.weekday - 1]} after ${clientFirst} accepts.`
      : `Starts when ${clientFirst} accepts.`;
  return `For ${clientFirst} only. ${starts}`;
}

export function CheckinsBody(
  p: BodyBase & {
    forms: readonly CoachForm[];
    schedules: readonly FormSchedule[];
    libraryLoading: boolean;
  },
) {
  const formById = new Map(p.forms.map((f) => [f.id, f]));
  const scheduleById = new Map(p.schedules.map((s) => [s.id, s]));
  const chosen = new Set(p.items.map((i) => i.refId));
  const available = p.schedules.filter(
    (s) =>
      !chosen.has(s.id) &&
      s.status !== "stopped" &&
      s.audience === "selected" &&
      REPEATING.has(s.trigger),
  );
  const onRule = (index: number, schedule: FormSchedule, rule: RuleFields) => {
    const override = overrideFrom(schedule, rule);
    p.onChange(
      p.items.map((it, i) =>
        i === index ? { ...it, config: override ? { override } : {} } : it,
      ),
    );
  };
  return (
    <View testID="checkins">
      {p.items.map((item, index) => {
        const schedule = item.refId ? scheduleById.get(item.refId) : undefined;
        const form = schedule ? formById.get(schedule.formId) : undefined;
        const title = form?.title ?? "Check-in";
        const rule = schedule ? ruleFor(schedule, item.config.override) : null;
        return (
          <Block key={item.refId ?? index} testID={`checkin-${item.refId}`}>
            <BlockHead
              title={title}
              sub={plural(form ? questionCount(form) : 0, "question")}
              leading={<IconClipboard size={16} color="#8A8A98" />}
              trailing={
                <RemoveButton
                  label={title}
                  onPress={() => p.onChange(without(p.items, index))}
                  testID={`checkin-remove-${item.refId}`}
                />
              }
            />
            <QuestionsToggle
              questions={form?.version?.questions ?? []}
              testID={`checkin-questions-${item.refId}`}
            />
            {schedule && rule ? (
              <View>
                <FieldLabel>How often</FieldLabel>
                <SegRow
                  label="How often"
                  value={schedule.trigger as "once" | "weekly" | "daily"}
                  onChange={() => {}}
                  options={[
                    { value: "once", label: "Once", disabled: true },
                    { value: "weekly", label: "Weekly", disabled: true },
                    { value: "daily", label: "Daily", disabled: true },
                  ]}
                  testID={`checkin-often-${item.refId}`}
                />
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  color="$text3"
                  marginTop={4}
                >
                  Set on the send rule in your Library.
                </Text>
                <RuleFieldsPresenter
                  trigger={schedule.trigger}
                  rule={rule}
                  onChange={(next) => onRule(index, schedule, next)}
                  testID={`checkin-rule-${item.refId}`}
                />
              </View>
            ) : null}
          </Block>
        );
      })}
      <LibraryPicker
        label="Add a check-in from your Library"
        empty="No repeating check-ins in your Library yet."
        loading={p.libraryLoading}
        rows={available.map((s) => ({
          id: s.id,
          title: formById.get(s.formId)?.title ?? "Check-in",
          sub:
            s.trigger === "weekly" && s.weekday
              ? `Weekly · ${WEEKDAYS_SHORT[s.weekday - 1]} ${s.timeLocal ?? ""}`.trim()
              : s.trigger === "daily"
                ? `Daily · ${s.timeLocal ?? ""}`.trim()
                : "Once",
        }))}
        onAdd={(id) => p.onChange(withAdded(p.items, id))}
        testID="checkin-picker"
      />
    </View>
  );
}

// ── C11n Programme ───────────────────────────────────────────────────────────

export function ProgrammeBody(
  p: BodyBase & {
    programmes: readonly ProgramSummary[];
    workouts: Readonly<Record<string, readonly ProgramWorkoutEntry[]>>;
    libraryLoading: boolean;
    offline: boolean;
  },
) {
  const [replacing, setReplacing] = useState<number | null>(null);
  const byId = new Map(p.programmes.map((x) => [x.id, x]));
  const chosen = new Set(p.items.map((i) => i.refId));
  const available = p.programmes.filter(
    (x) => !chosen.has(x.id) && x.workoutCount > 0,
  );
  const add = (id: string) => {
    if (replacing !== null) {
      p.onChange(
        renumber(
          p.items.map((it, i) =>
            i === replacing ? { refId: id, config: {}, sortOrder: i } : it,
          ),
        ),
      );
      setReplacing(null);
      return;
    }
    p.onChange(withAdded(p.items, id));
  };
  return (
    <View testID="programme">
      {p.items.map((item, index) => {
        const programme = byId.get(item.refId ?? "");
        const name = programme?.name ?? "Programme";
        const rows = [...(p.workouts[item.refId ?? ""] ?? [])].sort(
          (a, b) => a.position - b.position,
        );
        const week = programme
          ? rows.slice(0, Math.max(1, programme.daysPerWeek))
          : rows;
        return (
          <Block key={item.refId ?? index} testID={`programme-${item.refId}`}>
            <BlockHead
              title={name}
              sub={programmeMeta(programme)}
              trailing={
                <View flexDirection="row" gap={12}>
                  <LinkButton
                    onPress={() =>
                      setReplacing(replacing === index ? null : index)
                    }
                    testID={`programme-change-${item.refId}`}
                  >
                    Change
                  </LinkButton>
                  <LinkButton
                    onPress={() => p.onChange(without(p.items, index))}
                    testID={`programme-remove-${item.refId}`}
                  >
                    Remove
                  </LinkButton>
                </View>
              }
            />
            {week.length > 0 ? (
              <View marginTop={8}>
                <FieldLabel top={4}>Week 1, in order</FieldLabel>
                {week.map((w, i) => (
                  <View
                    key={w.id}
                    flexDirection="row"
                    alignItems="center"
                    gap={10}
                    paddingVertical={10}
                    borderBottomWidth={1}
                    borderBottomColor="$border"
                  >
                    <View flex={1}>
                      <Text
                        fontFamily="$body"
                        fontWeight="500"
                        fontSize={15}
                        color="$text"
                      >
                        {w.name}
                      </Text>
                      {w.estimatedDurationMinutes ? (
                        <Text fontFamily="$body" fontSize={12} color="$text3">
                          {`about ${w.estimatedDurationMinutes} min`}
                        </Text>
                      ) : null}
                    </View>
                    {index === 0 && i === 0 ? (
                      <View
                        height={22}
                        paddingHorizontal={8}
                        borderRadius={9999}
                        backgroundColor="rgba(167,139,250,0.14)"
                        justifyContent="center"
                      >
                        <Text
                          fontFamily="$body"
                          fontWeight="600"
                          fontSize={11}
                          color="#C4B5FD"
                        >
                          Next
                        </Text>
                      </View>
                    ) : null}
                  </View>
                ))}
              </View>
            ) : null}
          </Block>
        );
      })}
      <LibraryPicker
        label={
          replacing !== null
            ? "Pick a programme from your Library"
            : p.items.length > 0
              ? "Add another programme"
              : "Add a programme from your Library"
        }
        empty="No programmes with workouts in your Library yet."
        loading={p.libraryLoading}
        offline={p.offline}
        rows={available.map((x) => ({
          id: x.id,
          title: x.name,
          sub: programmeMeta(x),
        }))}
        onAdd={add}
        testID="programme-picker"
      />
    </View>
  );
}

// ── C11o Calorie and macro targets ───────────────────────────────────────────

const MACROS = [
  ["proteinG", "Protein"],
  ["carbsG", "Carbs"],
  ["fatG", "Fat"],
] as const;

function numOrNull(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

export function TargetsBody(p: BodyBase) {
  const coachSets = p.items.length > 0;
  const numbers = targetNumbers(p.items[0]);
  const [editing, setEditing] = useState(!numbers);
  const config = p.items[0]?.config ?? {};
  const set = (key: string, raw: string) =>
    p.onChange([
      {
        refId: null,
        sortOrder: 0,
        config: { ...config, [key]: numOrNull(raw) },
      },
    ]);
  const value = (key: string) =>
    typeof config[key] === "number" ? String(config[key]) : "";
  return (
    <View testID="targets">
      <SegRow
        label="Who sets targets"
        value={coachSets ? "coach" : "client"}
        onChange={(who) => {
          if (who === "coach" && !coachSets) {
            setEditing(true);
            p.onChange([{ refId: null, sortOrder: 0, config: {} }]);
          }
          if (who === "client" && coachSets) p.onChange([]);
        }}
        options={[
          { value: "coach", label: "You set them" },
          { value: "client", label: `${p.clientFirst} sets their own` },
        ]}
        testID="targets-who"
      />
      {coachSets ? (
        editing || !numbers ? (
          <View flexDirection="row" flexWrap="wrap" gap={12} marginTop={6}>
            <View width="47%">
              <FieldLabel>kcal a day</FieldLabel>
              <FieldInput
                value={value("dailyKcal")}
                onChangeText={(v) => set("dailyKcal", v)}
                accessibilityLabel="Calories a day"
                keyboardType="numeric"
                testID="targets-kcal"
              />
            </View>
            {MACROS.map(([key, label]) => (
              <View key={key} width="47%">
                <FieldLabel>{`${label}, g`}</FieldLabel>
                <FieldInput
                  value={value(key)}
                  onChangeText={(v) => set(key, v)}
                  accessibilityLabel={`${label} in grams`}
                  keyboardType="numeric"
                  testID={`targets-${key}`}
                />
              </View>
            ))}
          </View>
        ) : (
          <View marginTop={18}>
            <View flexDirection="row" alignItems="baseline" gap={8}>
              <Text
                fontFamily="$mono"
                fontWeight="700"
                fontSize={64}
                lineHeight={68}
                letterSpacing={-2.5}
                color="$text"
                testID="targets-kcal-value"
              >
                {formatKcal(numbers.dailyKcal)}
              </Text>
              <Text
                fontFamily="$mono"
                fontWeight="500"
                fontSize={18}
                color="$text3"
              >
                kcal a day
              </Text>
            </View>
            <View
              flexDirection="row"
              marginTop={16}
              paddingVertical={12}
              borderTopWidth={1}
              borderBottomWidth={1}
              borderColor="$border2"
            >
              {MACROS.map(([key, label], i) => (
                <View
                  key={key}
                  flex={1}
                  gap={3}
                  paddingLeft={i === 0 ? 0 : 14}
                  borderLeftWidth={i === 0 ? 0 : 1}
                  borderLeftColor="$border"
                >
                  <Text
                    fontFamily="$mono"
                    fontWeight="700"
                    fontSize={20}
                    color="$text"
                  >
                    {formatKcal(numbers[key])}
                    <Text fontFamily="$mono" fontSize={12} color="$text3">
                      g
                    </Text>
                  </Text>
                  <Text
                    fontFamily="$body"
                    fontWeight="600"
                    fontSize={10}
                    letterSpacing={1.6}
                    textTransform="uppercase"
                    color="$text3"
                  >
                    {label}
                  </Text>
                </View>
              ))}
            </View>
            <LinkButton onPress={() => setEditing(true)} testID="targets-edit">
              Edit numbers
            </LinkButton>
          </View>
        )
      ) : null}
      {coachSets ? (
        <Text
          fontFamily="$body"
          fontSize={12.5}
          lineHeight={18}
          color="$text3"
          marginTop={4}
        >
          {`Training and rest days can differ: set that in ${p.clientFirst}'s Nutrition tab after they accept.`}
        </Text>
      ) : null}
    </View>
  );
}

// ── C11p Meal plan ───────────────────────────────────────────────────────────

export function MealPlanBody(
  p: BodyBase & {
    plans: readonly SetupMealPlan[];
    libraryLoading: boolean;
    offline: boolean;
  },
) {
  const byId = new Map(p.plans.map((x) => [x.id, x]));
  const chosen = new Set(p.items.map((i) => i.refId));
  const available = p.plans.filter((x) => !chosen.has(x.id));
  return (
    <View testID="meal-plan">
      {p.items.length === 0 ? (
        <Text fontFamily="$body" fontSize={13} color="$text3" marginBottom={4}>
          No meal plan added. Pick one from your Library, or skip this.
        </Text>
      ) : null}
      {p.items.map((item, index) => {
        const plan = byId.get(item.refId ?? "");
        const name = plan?.name ?? "Meal plan";
        return (
          <Block key={item.refId ?? index} testID={`plan-${item.refId}`}>
            <BlockHead
              title={name}
              sub={planMeta(plan)}
              trailing={
                <LinkButton
                  onPress={() => p.onChange(without(p.items, index))}
                  testID={`plan-remove-${item.refId}`}
                >
                  Remove
                </LinkButton>
              }
            />
          </Block>
        );
      })}
      <AlwaysOpenList
        empty={
          p.libraryLoading
            ? "Loading your Library…"
            : p.offline
              ? "Your Library needs a connection. Try again when you're back online."
              : p.plans.length === 0
                ? "No meal plans in your Library yet."
                : null
        }
        rows={available.map((x) => ({
          id: x.id,
          title: x.name,
          sub: planMeta(x),
        }))}
        onAdd={(id) => p.onChange(withAdded(p.items, id))}
        testID="plan-picker"
      />
    </View>
  );
}

/** C11p lists the coach's plans with Add straight away (no toggle). */
function AlwaysOpenList(p: {
  empty: string | null;
  rows: readonly { id: string; title: string; sub: string }[];
  onAdd: (id: string) => void;
  testID: string;
}) {
  if (p.empty) {
    return (
      <Text
        fontFamily="$body"
        fontSize={12.5}
        color="$text3"
        testID={`${p.testID}-empty`}
      >
        {p.empty}
      </Text>
    );
  }
  return (
    <View testID={p.testID}>
      {p.rows.map((r) => (
        <View
          key={r.id}
          flexDirection="row"
          alignItems="center"
          gap={12}
          paddingVertical={12}
          borderBottomWidth={1}
          borderBottomColor="$border"
        >
          <View flex={1} minWidth={0} gap={2}>
            <Text
              fontFamily="$body"
              fontWeight="500"
              fontSize={15}
              color="$text"
            >
              {r.title}
            </Text>
            <Text fontFamily="$body" fontSize={12} color="$text3">
              {r.sub}
            </Text>
          </View>
          <Pressable
            onPress={() => p.onAdd(r.id)}
            accessibilityRole="button"
            accessibilityLabel={`Add ${r.title}`}
            testID={`${p.testID}-add-${r.id}`}
            style={{ minHeight: 44, justifyContent: "center" }}
          >
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={13}
              color="$accentTrainer"
            >
              Add
            </Text>
          </Pressable>
        </View>
      ))}
    </View>
  );
}

// ── C11q Resources ───────────────────────────────────────────────────────────

function resourceSub(r: SetupResource | undefined): string {
  return resourceKind(r);
}

export function ResourcesBody(
  p: BodyBase & {
    resources: readonly SetupResource[];
    libraryLoading: boolean;
    offline: boolean;
  },
) {
  const byId = new Map(p.resources.map((x) => [x.id, x]));
  const chosen = new Set(p.items.map((i) => i.refId));
  const available = p.resources.filter(
    (x) => !chosen.has(x.id) && !x.archivedAt,
  );
  return (
    <View testID="resources">
      {p.items.map((item, index) => {
        const resource = byId.get(item.refId ?? "");
        const title = resource?.title ?? "Resource";
        return (
          <Block key={item.refId ?? index} testID={`resource-${item.refId}`}>
            <BlockHead
              title={title}
              sub={resourceSub(resource)}
              trailing={
                <RemoveButton
                  label={title}
                  onPress={() => p.onChange(without(p.items, index))}
                  testID={`resource-remove-${item.refId}`}
                />
              }
            />
          </Block>
        );
      })}
      <LibraryPicker
        label="Add from your Library"
        empty="No resources in your Library yet."
        loading={p.libraryLoading}
        offline={p.offline}
        rows={available.map((x) => ({
          id: x.id,
          title: x.title,
          sub: resourceSub(x),
        }))}
        onAdd={(id) => p.onChange(withAdded(p.items, id))}
        testID="resource-picker"
      />
    </View>
  );
}

// ── C11r Welcome message ─────────────────────────────────────────────────────

export const WELCOME_MAX = 1000;

export function WelcomeBody(p: BodyBase & { programmeName: string | null }) {
  const text = welcomeText(p.items[0]);
  const setText = (next: string) =>
    p.onChange(
      next === ""
        ? []
        : [{ refId: null, sortOrder: 0, config: { text: next } }],
    );
  const append = (word: string) => {
    const sep = text === "" || text.endsWith(" ") ? "" : " ";
    setText(`${text}${sep}${word}`.slice(0, WELCOME_MAX));
  };
  return (
    <View testID="welcome">
      <FieldLabel top={4}>Message</FieldLabel>
      <FieldInput
        value={text}
        onChangeText={setText}
        accessibilityLabel="Message"
        multiline
        maxLength={WELCOME_MAX}
        testID="welcome-text"
      />
      <View flexDirection="row" gap={8} marginTop={8}>
        <ChipButton
          label="+ First name"
          onPress={() => append(p.clientFirst)}
          testID="welcome-first"
        />
        {p.programmeName ? (
          <ChipButton
            label="+ Programme name"
            onPress={() => append(p.programmeName!)}
            testID="welcome-programme"
          />
        ) : null}
      </View>
    </View>
  );
}

function ChipButton(p: { label: string; onPress: () => void; testID: string }) {
  return (
    <Pressable onPress={p.onPress} accessibilityRole="button" testID={p.testID}>
      <View
        height={36}
        paddingHorizontal={14}
        borderRadius={9999}
        borderWidth={1}
        borderColor="rgba(167,139,250,0.45)"
        backgroundColor="rgba(167,139,250,0.10)"
        justifyContent="center"
      >
        <Text fontFamily="$body" fontWeight="600" fontSize={13} color="#C4B5FD">
          {p.label}
        </Text>
      </View>
    </Pressable>
  );
}
