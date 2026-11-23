import { useEffect, useState } from "react";
import { Pressable, TextInput, View as RNView } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { ReorderableList } from "@/ui/components/workouts/ReorderableList";
import { ExerciseReorderHandle } from "@/ui/components/workouts/ExerciseReorderHandle";
import { USER_MEAL_NAME_MAX } from "@/domain/models/userMeals";

/**
 * <YourMealsSheetPresenter> — canvas N1b "Your meals" (PER-132, signed off 18
 * Nov): drag to reorder, Rename, Add a meal, Done. Every change is saved as
 * it happens (offline-first); Done just closes.
 *
 * The canvas subtitle ("Days on a plan use the plan's meals…") is left out:
 * plans no longer drive a day (Brad, 17 Nov).
 *
 * Pure: the container owns the list and the writes.
 */

export type YourMealRowVM = {
  id: string;
  name: string;
  /** "Default" or "Added by you". */
  sub: string;
};

export type YourMealsSheetProps = {
  visible: boolean;
  onClose: () => void;
  meals: readonly YourMealRowVM[];
  /** False while showing placeholders (the list was never fetched). */
  editable: boolean;
  /** True when the list is at the server's cap. */
  full: boolean;
  onRename: (id: string, name: string) => void;
  onReorder: (orderedIds: string[]) => void;
  onAdd: (name: string) => void;
  testID?: string;
};

export const YOUR_MEAL_ROW_HEIGHT = 60;

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
  const [value, setValue] = useState(initial);
  const submit = () => {
    const trimmed = value.trim();
    if (trimmed.length === 0) onCancel();
    else onSubmit(trimmed);
  };
  return (
    <TextInput
      value={value}
      onChangeText={setValue}
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

export function YourMealsSheetPresenter({
  visible,
  onClose,
  meals,
  editable,
  full,
  onRename,
  onReorder,
  onAdd,
  testID = "your-meals-sheet",
}: YourMealsSheetProps) {
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

  const listHeight = Math.min(meals.length, 6) * YOUR_MEAL_ROW_HEIGHT;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Your meals"
      scrollable={false}
      height="content"
      testID={testID}
    >
      <View gap={14}>
        <RNView style={{ height: listHeight }}>
          <ReorderableList
            testID={`${testID}-list`}
            rowHeight={YOUR_MEAL_ROW_HEIGHT}
            data={meals.map((m) => ({ ...m }))}
            onReorder={(_moved, _to, orderedIds) => {
              if (editable) onReorder(orderedIds);
            }}
            renderRow={(meal, { index, wrapHandle }) => (
              <View
                height={YOUR_MEAL_ROW_HEIGHT}
                flexDirection="row"
                alignItems="center"
                gap={8}
                borderBottomWidth={1}
                borderColor="$border"
                testID={`your-meal-${meal.id}`}
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
                {renaming === meal.id ? (
                  <NameInput
                    initial={meal.name}
                    placeholder={`Rename ${meal.name}`}
                    onSubmit={(name) => {
                      setRenaming(null);
                      if (name !== meal.name) onRename(meal.id, name);
                    }}
                    onCancel={() => setRenaming(null)}
                    testID={`your-meal-rename-input-${meal.id}`}
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
                        testID={`your-meal-rename-${meal.id}`}
                      >
                        <View
                          height={32}
                          paddingHorizontal={12}
                          borderRadius={9999}
                          borderWidth={1}
                          borderColor="$border"
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
