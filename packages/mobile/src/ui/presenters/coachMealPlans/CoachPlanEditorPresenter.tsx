import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";

import type {
  MacroVsTarget,
  TargetComparison,
} from "@/domain/services/nutritionPlans.service";
import { Btn } from "@/ui/components/foundation";
import {
  BackLink,
  EditedElsewhere,
  FieldInput,
  FieldLabel,
  LinkButton,
  Note,
} from "@/ui/presenters/coachForms/kit";
import { PlanTargetSummaryPresenter } from "@/ui/presenters/fuel/plans/PlanTargetSummaryPresenter";

export type EditorItemView = {
  id: string;
  name: string;
  /** "80 g × 1.25" */
  serving: string;
  /** "×1.25" */
  portion: string;
  kcal: string;
};

export type EditorMealView = {
  id: string;
  name: string;
  kcal: string;
  summary: string;
  open: boolean;
  error: string | null;
  items: EditorItemView[];
};

export type CoachPlanEditorProps = {
  isNew: boolean;
  backLabel: string;
  /** "Sam Patel · Sent 21 Oct · edits reach Sam automatically". */
  clientLine: string | null;
  name: string;
  nameError: string | null;
  /** The whole meal list (e.g. the last meal removed: "A plan has 1 to 20 meals."). */
  mealsError: string | null;
  comparison: TargetComparison;
  planned: { proteinG: number; carbsG: number; fatG: number };
  macros: readonly MacroVsTarget[];
  meals: readonly EditorMealView[];
  saveLabel: string;
  canSave: boolean;
  online: boolean;
  conflict: boolean;
  error: string | null;
  onBack: () => void;
  onName: (name: string) => void;
  onMealName: (mealId: string, name: string) => void;
  onToggleMeal: (mealId: string) => void;
  onPortion: (mealId: string, itemId: string, by: 1 | -1) => void;
  onRemoveItem: (mealId: string, itemId: string) => void;
  onRemoveMeal: (mealId: string) => void;
  onAddTo: (mealId: string) => void;
  onAddMeal: () => void;
  onSave: () => void;
  onDismissConflict: () => void;
};

function Stepper(p: {
  label: string;
  portion: string;
  onLess: () => void;
  onMore: () => void;
  testID: string;
}) {
  const btn = (text: string, onPress: () => void, a11y: string, id: string) => (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={a11y}
      hitSlop={6}
      testID={id}
      style={{
        width: 30,
        height: 30,
        borderRadius: 9,
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: "rgba(255,255,255,0.06)",
      }}
    >
      <Text fontFamily="$body" fontSize={16} color="$text">
        {text}
      </Text>
    </Pressable>
  );
  return (
    <View flexDirection="row" alignItems="center" gap={4}>
      {btn("−", p.onLess, `Less ${p.label}`, `${p.testID}-less`)}
      <Text
        fontFamily="$mono"
        fontSize={12.5}
        color="$text2"
        minWidth={40}
        textAlign="center"
      >
        {p.portion}
      </Text>
      {btn("+", p.onMore, `More ${p.label}`, `${p.testID}-more`)}
    </View>
  );
}

/** C3 Edit a plan (iPhone): macro wheel, meals and portions. */
export function CoachPlanEditorPresenter(p: CoachPlanEditorProps) {
  return (
    <View flex={1} backgroundColor="$bg" testID="coach-plan-editor">
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      >
        <BackLink label={p.backLabel} onPress={p.onBack} />
        <Text
          fontFamily="$heading"
          fontWeight="700"
          fontSize={24}
          color="$text"
          marginTop={8}
        >
          {p.isNew ? "New meal plan" : "Edit meal plan"}
        </Text>
        {p.clientLine ? (
          <Text fontFamily="$body" fontSize={12.5} color="$text3" marginTop={2}>
            {p.clientLine}
          </Text>
        ) : null}
        {!p.online ? (
          <Note testID="coach-plan-offline">
            You’re offline. Your changes are saved on this phone and send when
            you’re back.
          </Note>
        ) : null}
        {p.conflict ? (
          <EditedElsewhere
            onDismiss={p.onDismissConflict}
            testID="coach-plan-conflict"
          />
        ) : null}
        {p.error ? <Note testID="coach-plan-error">{p.error}</Note> : null}

        <FieldLabel>Plan name</FieldLabel>
        <FieldInput
          value={p.name}
          onChangeText={p.onName}
          accessibilityLabel="Plan name"
          placeholder="e.g. Lean bulk · Training day"
          testID="coach-plan-name"
        />
        {p.nameError ? (
          <Text fontFamily="$body" fontSize={12} color="$error" marginTop={4}>
            {p.nameError}
          </Text>
        ) : null}

        <View marginTop={16}>
          <PlanTargetSummaryPresenter
            comparison={p.comparison}
            planned={p.planned}
            macros={p.macros}
            testID="coach-plan-summary"
          />
        </View>

        <View marginTop={16} gap={10}>
          {p.meals.map((m) => (
            <View
              key={m.id}
              padding={12}
              borderRadius={14}
              backgroundColor="$surface"
              borderWidth={1}
              borderColor="$border2"
              testID={`coach-plan-meal-${m.id}`}
            >
              <Pressable
                onPress={() => p.onToggleMeal(m.id)}
                accessibilityRole="button"
                accessibilityLabel={`${m.open ? "Collapse" : "Expand"} ${m.name}`}
                accessibilityState={{ expanded: m.open }}
                testID={`coach-plan-meal-toggle-${m.id}`}
              >
                <View flexDirection="row" alignItems="center" gap={8}>
                  <Text
                    flex={1}
                    fontFamily="$body"
                    fontWeight="600"
                    fontSize={15}
                    color="$text"
                  >
                    {m.name || "Unnamed meal"}
                  </Text>
                  <Text fontFamily="$mono" fontSize={12.5} color="$text2">
                    {m.kcal}
                  </Text>
                </View>
              </Pressable>
              {!m.open && m.summary ? (
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  color="$text3"
                  marginTop={4}
                  numberOfLines={1}
                >
                  {m.summary}
                </Text>
              ) : null}
              {m.open ? (
                <View marginTop={8} gap={2}>
                  <FieldInput
                    value={m.name}
                    onChangeText={(t) => p.onMealName(m.id, t)}
                    accessibilityLabel="Meal name"
                    testID={`coach-plan-meal-name-${m.id}`}
                  />
                  {m.error ? (
                    <Text fontFamily="$body" fontSize={12} color="$error">
                      {m.error}
                    </Text>
                  ) : null}
                  {m.items.length === 0 ? (
                    <Text
                      fontFamily="$body"
                      fontSize={12.5}
                      color="$text3"
                      marginTop={8}
                    >
                      Nothing in this meal yet.
                    </Text>
                  ) : null}
                  {m.items.map((it) => (
                    <View
                      key={it.id}
                      flexDirection="row"
                      alignItems="center"
                      gap={8}
                      paddingVertical={10}
                      borderBottomWidth={1}
                      borderBottomColor="$border"
                    >
                      <View flex={1} gap={2}>
                        <Text
                          fontFamily="$body"
                          fontSize={14}
                          color="$text"
                          numberOfLines={1}
                        >
                          {it.name}
                        </Text>
                        <Text fontFamily="$body" fontSize={12} color="$text3">
                          {it.serving}
                        </Text>
                      </View>
                      <Stepper
                        label={it.name}
                        portion={it.portion}
                        onLess={() => p.onPortion(m.id, it.id, -1)}
                        onMore={() => p.onPortion(m.id, it.id, 1)}
                        testID={`coach-plan-portion-${it.id}`}
                      />
                      <Text
                        fontFamily="$mono"
                        fontSize={12.5}
                        color="$text2"
                        minWidth={40}
                        textAlign="right"
                      >
                        {it.kcal}
                      </Text>
                      <Pressable
                        onPress={() => p.onRemoveItem(m.id, it.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Remove ${it.name}`}
                        hitSlop={8}
                        testID={`coach-plan-remove-${it.id}`}
                      >
                        <Text fontFamily="$body" fontSize={16} color="$text3">
                          ×
                        </Text>
                      </Pressable>
                    </View>
                  ))}
                  <View flexDirection="row" gap={16}>
                    <LinkButton
                      onPress={() => p.onAddTo(m.id)}
                      testID={`coach-plan-add-${m.id}`}
                    >
                      + Add food
                    </LinkButton>
                    {p.meals.length > 1 ? (
                      <LinkButton
                        onPress={() => p.onRemoveMeal(m.id)}
                        testID={`coach-plan-remove-meal-${m.id}`}
                      >
                        Remove meal
                      </LinkButton>
                    ) : null}
                  </View>
                </View>
              ) : null}
            </View>
          ))}
          {p.mealsError ? (
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$error"
              accessibilityRole="alert"
              testID="coach-plan-meals-error"
            >
              {p.mealsError}
            </Text>
          ) : null}
          <Btn
            variant="outline"
            tone="trainer"
            size="md"
            full
            onPress={p.onAddMeal}
            testID="coach-plan-add-meal"
          >
            Add a meal
          </Btn>
        </View>
      </ScrollView>
      <View paddingHorizontal={20} paddingVertical={10}>
        <Btn
          variant="filled"
          tone="trainer"
          size="lg"
          full
          disabled={!p.canSave}
          onPress={p.onSave}
          testID="coach-plan-save"
        >
          {p.saveLabel}
        </Btn>
      </View>
    </View>
  );
}
