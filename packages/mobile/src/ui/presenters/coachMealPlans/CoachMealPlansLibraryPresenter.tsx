import { ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation";
import {
  CountText,
  EditedElsewhere,
  ListRow,
  OfflineNote,
  SegRow,
} from "@/ui/presenters/coachForms/kit";

export type MealsLibraryTab = "plans" | "recipes" | "meals";

export type LibraryRowView = {
  id: string;
  title: string;
  subtitle: string;
  kcal: string;
};

export type CoachMealPlansLibraryProps = {
  tab: MealsLibraryTab;
  plans: readonly LibraryRowView[] | null;
  recipes: readonly LibraryRowView[] | null;
  meals: readonly LibraryRowView[] | null;
  online: boolean;
  conflict: boolean;
  onTab: (tab: MealsLibraryTab) => void;
  onNew: () => void;
  onPlan: (id: string) => void;
  onRecipe: (id: string) => void;
  onDismissConflict: () => void;
};

const count = (list: readonly unknown[] | null) =>
  list ? ` · ${list.length}` : "";

/** C2 Library · Nutrition (iPhone): your plans, recipes and saved meals. */
export function CoachMealPlansLibraryPresenter(p: CoachMealPlansLibraryProps) {
  const list =
    p.tab === "plans" ? p.plans : p.tab === "recipes" ? p.recipes : p.meals;
  const empty =
    p.tab === "plans"
      ? "No plans yet. Build one, then send it to a client with a note."
      : p.tab === "recipes"
        ? "No recipes yet. Recipes you save show here."
        : "No saved meals yet. Meals you save show here.";
  const onPress =
    p.tab === "plans" ? p.onPlan : p.tab === "recipes" ? p.onRecipe : undefined;
  return (
    <ScrollView
      contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}
      testID="coach-meal-plans-library"
    >
      <View flexDirection="row" alignItems="center" marginTop={12} gap={10}>
        <View flex={1}>
          <SegRow
            label="Show"
            value={p.tab}
            onChange={p.onTab}
            options={[
              { value: "plans", label: `Plans${count(p.plans)}` },
              { value: "recipes", label: `Recipes${count(p.recipes)}` },
              { value: "meals", label: `Meals${count(p.meals)}` },
            ]}
            testID="coach-meals-tabs"
          />
        </View>
      </View>
      {!p.online ? <OfflineNote testID="coach-meals-offline" /> : null}
      {p.conflict ? (
        <EditedElsewhere
          onDismiss={p.onDismissConflict}
          testID="coach-meals-conflict"
        />
      ) : null}
      {p.tab === "plans" ? (
        <View marginTop={12}>
          <Btn
            variant="soft"
            tone="trainer"
            size="md"
            full
            onPress={p.onNew}
            testID="coach-meals-new"
          >
            New plan
          </Btn>
        </View>
      ) : null}
      <View marginTop={8}>
        {list === null ? (
          <Text fontFamily="$body" fontSize={13} color="$text3" marginTop={12}>
            Loading…
          </Text>
        ) : list.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            marginTop={12}
            testID="coach-meals-empty"
          >
            {empty}
          </Text>
        ) : (
          list.map((r) => (
            <ListRow
              key={r.id}
              title={r.title}
              subtitle={r.subtitle}
              right={<CountText text={r.kcal} muted={false} />}
              onPress={onPress ? () => onPress(r.id) : undefined}
              testID={`coach-meals-row-${r.id}`}
            />
          ))
        )}
      </View>
    </ScrollView>
  );
}
