import { useEffect, useRef, useState } from "react";
import { useForm } from "react-hook-form";
import { mealNameResolver, type MealNameValues } from "@/ui/forms/fuelForms";
import { Pressable, TextInput, View as RNView } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconCheck } from "@/ui/components/icons";
import { ReorderableList } from "@/ui/components/workouts/ReorderableList";
import { ExerciseReorderHandle } from "@/ui/components/workouts/ExerciseReorderHandle";
import { USER_MEAL_NAME_MAX } from "@/domain/models/userMeals";
import { CloseBtn, SheetTitle } from "./PlanChrome";

/**
 * <PlanMealsSheetPresenter> — canvas N28b "Your meals" in a plan (PER-133):
 * the same Your meals sheet as Log (N1b) with a tick on each row. Ticks pick
 * the meals this plan has; rename, reorder and Add a meal change Your meals
 * themselves (saved straight away, as in N1b). Done closes.
 *
 * Pure: the container owns the list, the ticks and the writes.
 */

export type PlanMealRowVM = {
  id: string;
  name: string;
  /** "Default" or "Added by you". */
  sub: string;
  ticked: boolean;
};

export type PlanMealsSheetProps = {
  visible: boolean;
  onClose: () => void;
  meals: readonly PlanMealRowVM[];
  /** False while showing placeholders (Your meals never fetched). */
  editable: boolean;
  /** Your meals is at the server's cap. */
  full: boolean;
  onToggle: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAdd: (name: string) => void;
  testID?: string;
};

export const PLAN_MEAL_ROW_HEIGHT = 60;

function NameInput({
  initial,
  placeholder,
  onSubmit,
  onCancel,
  testID,
}: {
  initial: string;
  placeholder: string;
  onSubmit: (name: string) => void;
  onCancel: () => void;
  testID: string;
}) {
  // A react-hook-form (PER-147), the same rules as Your meals: a blank name
  // cancels, a good one is saved trimmed. Return then blur both submit; the
  // submit is async, so only the first one counts.
  const form = useForm<MealNameValues>({
    resolver: mealNameResolver,
    defaultValues: { name: initial },
  });
  const value = form.watch("name");
  const done = useRef(false);
  const submit = () => {
    if (done.current) return;
    done.current = true;
    void form.handleSubmit(
      ({ name }) => onSubmit(name.trim()),
      () => onCancel(),
    )();
  };
  return (
    <TextInput
      value={value}
      onChangeText={(v) => form.setValue("name", v, { shouldDirty: true })}
      onSubmitEditing={submit}
      onBlur={submit}
      autoFocus
      maxLength={USER_MEAL_NAME_MAX}
      placeholder={placeholder}
      placeholderTextColor="#8A8A98"
      returnKeyType="done"
      accessibilityLabel={placeholder}
      testID={testID}
      style={{
        flex: 1,
        height: 40,
        paddingHorizontal: 12,
        borderRadius: 12,
        backgroundColor: "#1A1D29",
        borderWidth: 1,
        borderColor: "rgba(34,211,238,0.55)",
        color: "#F4F4F8",
        fontSize: 15,
      }}
    />
  );
}

export function PlanMealsSheetPresenter({
  visible,
  onClose,
  meals,
  editable,
  full,
  onToggle,
  onRename,
  onReorder,
  onAdd,
  testID = "plan-meals-sheet",
}: PlanMealsSheetProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    if (!visible) {
      setRenaming(null);
      setAdding(false);
    }
  }, [visible]);

  const ids = meals.map((m) => m.id);
  const move = (id: string, direction: -1 | 1) => {
    const from = ids.indexOf(id);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= ids.length) return;
    const next = [...ids];
    next.splice(from, 1);
    next.splice(to, 0, id);
    onReorder(next);
  };

  const listHeight = Math.min(meals.length, 6) * PLAN_MEAL_ROW_HEIGHT;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      scrollable={false}
      height="content"
      testID={testID}
    >
      <View gap={14}>
        <View
          flexDirection="row"
          alignItems="center"
          justifyContent="space-between"
        >
          <SheetTitle>Your meals</SheetTitle>
          <CloseBtn onPress={onClose} testID={`${testID}-close`} />
        </View>
        <Text fontFamily="$body" fontSize={13} color="$text2">
          Tick the meals this plan has. Rename or reorder them here too.
        </Text>
        <RNView style={{ height: listHeight }}>
          <ReorderableList
            testID={`${testID}-list`}
            rowHeight={PLAN_MEAL_ROW_HEIGHT}
            data={meals.map((m) => ({ ...m }))}
            onReorder={(_moved, _to, orderedIds) => {
              if (editable) onReorder(orderedIds);
            }}
            renderRow={(meal, { index, wrapHandle }) => (
              <View
                height={PLAN_MEAL_ROW_HEIGHT}
                flexDirection="row"
                alignItems="center"
                gap={10}
                borderBottomWidth={1}
                borderColor="$border"
                testID={`plan-meal-${meal.id}`}
              >
                {editable ? (
                  wrapHandle(
                    <ExerciseReorderHandle
                      label={meal.name}
                      position={index + 1}
                      total={meals.length}
                      onMove={(d) => move(meal.id, d)}
                      draggable
                    />,
                  )
                ) : (
                  <View width={8} />
                )}
                <Pressable
                  onPress={() => onToggle(meal.id)}
                  accessibilityRole="checkbox"
                  accessibilityLabel={meal.name}
                  accessibilityState={{ checked: meal.ticked }}
                  testID={`plan-meal-tick-${meal.id}`}
                >
                  <View
                    width={28}
                    height={28}
                    borderRadius={8}
                    alignItems="center"
                    justifyContent="center"
                    backgroundColor={meal.ticked ? "$primary" : "transparent"}
                    borderWidth={meal.ticked ? 0 : 1.5}
                    borderColor="$text4"
                  >
                    {meal.ticked ? (
                      <IconCheck size={14} color="#042F39" strokeWidth={3} />
                    ) : null}
                  </View>
                </Pressable>
                {renaming === meal.id ? (
                  <NameInput
                    initial={meal.name}
                    placeholder={`Rename ${meal.name}`}
                    onSubmit={(name) => {
                      setRenaming(null);
                      if (name !== meal.name) onRename(meal.id, name);
                    }}
                    onCancel={() => setRenaming(null)}
                    testID={`plan-meal-rename-input-${meal.id}`}
                  />
                ) : (
                  <>
                    <View flex={1} gap={2}>
                      <Text
                        fontFamily="$body"
                        fontSize={15}
                        fontWeight="500"
                        color="$text"
                        numberOfLines={1}
                      >
                        {meal.name}
                      </Text>
                      <Text fontFamily="$body" fontSize={12} color="$text3">
                        {meal.sub}
                      </Text>
                    </View>
                    {editable ? (
                      <Pressable
                        onPress={() => setRenaming(meal.id)}
                        accessibilityRole="button"
                        accessibilityLabel={`Rename ${meal.name}`}
                        testID={`plan-meal-rename-${meal.id}`}
                      >
                        <View
                          height={32}
                          paddingHorizontal={12}
                          borderRadius={9999}
                          borderWidth={1}
                          borderColor="$border2"
                          backgroundColor="$surface"
                          justifyContent="center"
                        >
                          <Text
                            fontFamily="$body"
                            fontSize={12}
                            fontWeight="600"
                            color="$text2"
                          >
                            Rename
                          </Text>
                        </View>
                      </Pressable>
                    ) : null}
                  </>
                )}
              </View>
            )}
          />
        </RNView>

        {!editable ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            testID={`${testID}-offline`}
          >
            Connect to the internet once to edit your meals.
          </Text>
        ) : null}

        {editable && adding ? (
          <View flexDirection="row" gap={8} alignItems="center">
            <NameInput
              initial=""
              placeholder="Meal name"
              onSubmit={(name) => {
                setAdding(false);
                onAdd(name);
              }}
              onCancel={() => setAdding(false)}
              testID={`${testID}-new-name`}
            />
          </View>
        ) : null}

        <Btn
          variant="outline"
          tone="primary"
          size="lg"
          full
          disabled={!editable || full || adding}
          onPress={() => setAdding(true)}
          testID={`${testID}-add`}
        >
          Add a meal
        </Btn>
        <Btn
          variant="filled"
          tone="primary"
          size="lg"
          full
          onPress={onClose}
          testID={`${testID}-done`}
        >
          Done
        </Btn>
      </View>
    </BottomSheet>
  );
}
