import { Pressable, ScrollView, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Btn, HeaderBar } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { EmptyState } from "@/ui/components";
import { IconBack, IconCheck, IconInfo } from "@/ui/components/icons";

/**
 * <SaveMealPresenter> — "Save a meal" quick-save form (recipes.jsx
 * `CreateMealManual`). Builds a meal preset from already-logged entries
 * (today + yesterday); the container reads them from the cached day
 * aggregate. PR1 has no "start blank and add manually" path — every row is
 * a real logged entry.
 *
 * Implements: specs/milestones (Fuel → Recipes PR1 brief) § <SaveMealPresenter>
 */

export type SaveMealRowVM = {
  entryId: string;
  /** Pre-formatted "Today · Breakfast — Oatmeal · 480 kcal". */
  label: string;
  selected: boolean;
};

export type SaveMealPresenterProps = {
  name: string;
  onNameChange: (name: string) => void;
  rows: readonly SaveMealRowVM[];
  onToggleRow: (entryId: string) => void;
  canSave: boolean;
  isSaving: boolean;
  onSave: () => void;
  onBack: () => void;
  testID?: string;
};

export function SaveMealPresenter({
  name,
  onNameChange,
  rows,
  onToggleRow,
  canSave,
  isSaving,
  onSave,
  onBack,
  testID = "save-meal-screen",
}: SaveMealPresenterProps) {
  const insets = useSafeAreaInsets();
  const primaryInk = toneHex("primary").base;

  return (
    <View flex={1} paddingTop={insets.top} testID={testID}>
      <HeaderBar
        title="Save a meal"
        eyebrow="QUICK SAVE"
        leading={
          <Pressable
            onPress={onBack}
            accessibilityRole="button"
            accessibilityLabel="Back"
            testID="save-meal-back"
            style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
          >
            <IconBack size={18} color="#B8B8C4" />
          </Pressable>
        }
        trailing={
          <Btn
            variant="filled"
            tone="primary"
            size="sm"
            onPress={onSave}
            disabled={!canSave || isSaving}
            testID="save-meal-save"
          >
            Save
          </Btn>
        }
        testID="save-meal-header"
      />
      <ScrollView
        contentContainerStyle={{
          paddingHorizontal: 16,
          paddingBottom: 140,
          gap: 14,
        }}
      >
        <View gap={6}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={10.5}
            letterSpacing={1.5}
            textTransform="uppercase"
            color="$text3"
          >
            Name
          </Text>
          <TextInput
            value={name}
            onChangeText={onNameChange}
            placeholder="e.g. Lunch prep — Mon batch"
            placeholderTextColor="#8A8A98"
            editable={!isSaving}
            accessibilityLabel="Meal name"
            testID="save-meal-name-input"
            style={{
              height: 44,
              borderRadius: 10,
              borderWidth: 1,
              borderColor: "#232735",
              backgroundColor: "#181B26",
              paddingHorizontal: 12,
              color: "#F4F4F8",
              fontFamily: "Geist",
              fontSize: 13,
            }}
          />
        </View>

        <View gap={8}>
          <Text
            fontFamily="$display"
            fontWeight="600"
            fontSize={10.5}
            letterSpacing={1.5}
            textTransform="uppercase"
            color="$text3"
          >
            Items · build from
          </Text>

          {rows.length === 0 ? (
            <EmptyState
              icon={<IconInfo size={24} color="#8A8A98" />}
              title="Nothing logged yet"
              description="Log some food today or yesterday, then come back to save it as a meal."
              testID="save-meal-empty"
            />
          ) : (
            <View
              borderWidth={1}
              borderColor="$border"
              backgroundColor="$surface2"
              borderRadius={14}
              padding={14}
              gap={6}
            >
              <Text fontFamily="$body" fontSize={12.5} color="$text2">
                Pick the logged items to save as a template:
              </Text>
              {rows.map((row) => (
                <Pressable
                  key={row.entryId}
                  onPress={
                    isSaving ? undefined : () => onToggleRow(row.entryId)
                  }
                  disabled={isSaving}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: row.selected }}
                  testID={`save-meal-row-${row.entryId}`}
                  style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
                >
                  <View
                    flexDirection="row"
                    alignItems="center"
                    gap={10}
                    backgroundColor="$surface3"
                    borderWidth={1}
                    borderColor="$border2"
                    borderRadius={10}
                    padding={10}
                  >
                    <View
                      width={22}
                      height={22}
                      borderRadius={6}
                      alignItems="center"
                      justifyContent="center"
                      backgroundColor={
                        row.selected ? "$primaryDim" : "transparent"
                      }
                      borderWidth={row.selected ? 0 : 1}
                      borderColor="$border2"
                    >
                      {row.selected ? (
                        <IconCheck size={13} color={primaryInk} />
                      ) : null}
                    </View>
                    <Text
                      flex={1}
                      fontFamily="$body"
                      fontSize={12.5}
                      color="$text"
                    >
                      {row.label}
                    </Text>
                  </View>
                </Pressable>
              ))}
            </View>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
