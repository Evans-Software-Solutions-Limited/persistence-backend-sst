import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import {
  EyebrowHead,
  LinkButton,
  Note,
  StatusPill,
  type PillTone,
} from "@/ui/presenters/coachForms/kit";

export type NutritionPlanRow = {
  assignmentId: string;
  name: string;
  /** "5 meals · 2,476 planned" */
  planned: string;
  status: string;
  tone: PillTone;
};

export type ClientNutritionTabProps = {
  clientFirst: string;
  /** "2,500 kcal · 180P 300C 70F", or null without a target. */
  target: string | null;
  /** "Set by you" / "Sam’s own target". */
  targetBy: string | null;
  rows: readonly NutritionPlanRow[] | null;
  loggedThisWeek: string | null;
  /** "5 of 7 days on target · 1 not logged" (PER-114). */
  calories: string | null;
  online: boolean;
  /** "Offline · showing Sam as of 09:14". */
  offlineLine: string | null;
  error: string | null;
  onAdd: () => void;
  onOpen: (assignmentId: string) => void;
  onMore: (assignmentId: string) => void;
  onShareRecipe: () => void;
  onRetry: () => void;
};

/** C3.2b iPhone · Nutrition: the client's target, their plans, adherence. */
export function ClientNutritionTabPresenter(p: ClientNutritionTabProps) {
  return (
    <View paddingHorizontal={20} paddingTop={12} testID="client-nutrition-tab">
      {p.offlineLine ? (
        <Note testID="client-nutrition-offline">{p.offlineLine}</Note>
      ) : null}
      {p.error ? (
        <Note testID="client-nutrition-error" onDismiss={p.onRetry}>
          {p.error}
        </Note>
      ) : null}

      <View marginTop={12}>
        <EyebrowHead title="Target" />
        {p.target ? (
          <View gap={2} testID="client-nutrition-target">
            <Text fontFamily="$mono" fontSize={14} color="$text">
              {p.target}
            </Text>
            <Text fontFamily="$body" fontSize={12} color="$text3">
              {p.targetBy} · plans are measured against it
            </Text>
          </View>
        ) : (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            testID="client-nutrition-no-target"
          >
            {p.clientFirst} has no calorie target yet. Plans show what’s
            planned until there is one.
          </Text>
        )}
      </View>

      <View marginTop={18}>
        <EyebrowHead
          title={`Meal plans${p.rows ? ` · ${p.rows.length}` : ""}`}
          onAdd={p.online ? p.onAdd : undefined}
          addLabel={`Add a meal plan for ${p.clientFirst}`}
          testID="client-nutrition-plans"
        />
        {p.rows === null ? (
          <Text fontFamily="$body" fontSize={13} color="$text3">
            Loading…
          </Text>
        ) : p.rows.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            testID="client-nutrition-empty"
          >
            No meal plans. Add one from your library or build one for{" "}
            {p.clientFirst}.
          </Text>
        ) : (
          p.rows.map((r) => (
            <View
              key={r.assignmentId}
              flexDirection="row"
              alignItems="center"
              gap={8}
              paddingVertical={12}
              borderBottomWidth={1}
              borderBottomColor="$border"
            >
              <Pressable
                style={{ flex: 1 }}
                onPress={() => p.onOpen(r.assignmentId)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${r.name}`}
                testID={`client-plan-${r.assignmentId}`}
              >
                <View gap={4}>
                  <Text
                    fontFamily="$body"
                    fontWeight="500"
                    fontSize={15}
                    color="$text"
                    numberOfLines={1}
                  >
                    {r.name}
                  </Text>
                  <Text fontFamily="$body" fontSize={12} color="$text3">
                    {r.planned}
                  </Text>
                  <View flexDirection="row">
                    <StatusPill tone={r.tone} text={r.status} />
                  </View>
                </View>
              </Pressable>
              <Pressable
                onPress={() => p.onMore(r.assignmentId)}
                accessibilityRole="button"
                accessibilityLabel={`${r.name} options`}
                hitSlop={10}
                testID={`client-plan-more-${r.assignmentId}`}
              >
                <Text fontFamily="$body" fontSize={18} color="$text2">
                  ⋯
                </Text>
              </Pressable>
            </View>
          ))
        )}
        {p.loggedThisWeek ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            marginTop={8}
            testID="client-nutrition-logged"
          >
            {p.loggedThisWeek}
          </Text>
        ) : null}
        <LinkButton
          onPress={p.onShareRecipe}
          disabled={!p.online}
          testID="client-nutrition-share"
        >
          {`Share a recipe with ${p.clientFirst}`}
        </LinkButton>
      </View>

      {p.calories ? (
        <View marginTop={12} testID="client-nutrition-calories">
          <EyebrowHead title="Calories · last 7 days" />
          <Text fontFamily="$body" fontSize={14} color="$text">
            {p.calories}
          </Text>
        </View>
      ) : null}
    </View>
  );
}
