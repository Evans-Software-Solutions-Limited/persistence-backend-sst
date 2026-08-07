/**
 * <ShoppingListPresenter> — the Mealprint shopping list (spec-26 amendment
 * 2026-08, § B, STORY-006), ported from `AMShopping`
 * (gtm-d8-anymeal-screens.jsx). Pure — reads `list` + local `checked` map,
 * fires `onToggleItem`/`onBack`; owns no state of its own.
 *
 * Day-scoped (decision B.1): the prototype's list is per-week ("WEEK OF …"),
 * this ships against a single accepted day plan instead — the progress
 * card's eyebrow reflects that rather than carrying over the week framing.
 *
 * Check-off is LOCAL optimistic state only (decision B.2) — there is no
 * server write this slice, hence the `OFFLINE ✓` pill: the list itself came
 * from a fresh network read (nothing is cached), but once rendered, ticking
 * items off needs no connectivity at all.
 */

import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Card, HeaderBar, IconBtn, Pill } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";
import { IconCheck, IconChevronL } from "@/ui/components/icons";
import type { ShoppingList } from "@/domain/models/shoppingList";
import { countChecked } from "@/domain/models/shoppingList";

const GOLD = toneHex("gold");

export type ShoppingListProps = {
  readonly loading: boolean;
  readonly error: string | null;
  readonly list: ShoppingList | null;
  readonly checked: Readonly<Record<string, boolean>>;
  readonly onToggleItem: (itemId: string) => void;
  readonly onBack: () => void;
  readonly testID?: string;
};

export function ShoppingListPresenter({
  loading,
  error,
  list,
  checked,
  onToggleItem,
  onBack,
  testID = "shopping-list-screen",
}: ShoppingListProps) {
  const insets = useSafeAreaInsets();
  const done = list ? countChecked(list, checked) : 0;
  const total = list?.totalItems ?? 0;
  const pct = total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0;

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <HeaderBar
        title="Shopping list"
        leading={
          <IconBtn
            icon={<IconChevronL size={18} />}
            tone="ghost"
            onPress={onBack}
            testID="shopping-list-back"
            accessibilityLabel="Back"
          />
        }
        trailing={
          <Pill tone="neutral" size="xs" testID="shopping-list-offline-pill">
            OFFLINE ✓
          </Pill>
        }
      />

      {loading && list === null ? (
        <View flex={1} alignItems="center" justifyContent="center">
          <Text fontFamily="$body" fontSize={13} color="$text3">
            Loading your shopping list…
          </Text>
        </View>
      ) : error && list === null ? (
        <View
          flex={1}
          alignItems="center"
          justifyContent="center"
          padding={24}
          gap={8}
          testID="shopping-list-error"
        >
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={15}
            color="$text"
            textAlign="center"
          >
            Couldn&apos;t load your shopping list
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            textAlign="center"
          >
            {error}
          </Text>
        </View>
      ) : list === null ? null : (
        // ScrollView, not a plain View: a day plan across 3-5 meals explodes
        // into 15-40 aisle rows, well past a phone viewport. A flex View would
        // clip the lower aisles (incl. the Other bucket where non-mass items
        // land) with no way to reach them — the recurring "won't scroll" trap.
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{
            padding: 16,
            gap: 16,
            paddingBottom: insets.bottom + 24,
          }}
          testID="shopping-list-scroll"
        >
          <Card
            pad={14}
            radius={14}
            accent="gold"
            testID="shopping-list-progress"
          >
            <View
              flexDirection="row"
              alignItems="center"
              justifyContent="space-between"
              marginBottom={10}
            >
              <View>
                <Text
                  fontFamily="$display"
                  fontSize={10.5}
                  fontWeight="600"
                  letterSpacing={1.5}
                  textTransform="uppercase"
                  color="$gold"
                >
                  Today&apos;s plan
                </Text>
                <Text
                  fontFamily="$display"
                  fontWeight="700"
                  fontSize={15}
                  color="$text"
                  marginTop={3}
                >
                  {total} {total === 1 ? "item" : "items"}
                </Text>
              </View>
              <Text fontFamily="$mono" fontSize={13} color="$text2">
                {done}/{total}
              </Text>
            </View>
            <View
              height={6}
              borderRadius={3}
              backgroundColor="$surface3"
              overflow="hidden"
            >
              <View
                height={6}
                borderRadius={3}
                width={`${pct}%`}
                backgroundColor="$gold"
              />
            </View>
          </Card>

          {list.aisles.map((aisleGroup) => (
            <View key={aisleGroup.aisle} gap={8}>
              <Text
                fontFamily="$display"
                fontSize={10.5}
                fontWeight="600"
                letterSpacing={1.5}
                textTransform="uppercase"
                color="$text3"
                paddingLeft={2}
              >
                {aisleGroup.aisle}
              </Text>
              <Card
                pad={0}
                radius={14}
                testID={`shopping-aisle-${aisleGroup.aisle}`}
              >
                {aisleGroup.items.map((item, index) => {
                  const isChecked = Boolean(checked[item.id]);
                  return (
                    <Pressable
                      key={item.id}
                      onPress={() => onToggleItem(item.id)}
                      testID={`shopping-item-${item.id}`}
                      accessibilityRole="checkbox"
                      accessibilityLabel={item.name}
                      accessibilityState={{ checked: isChecked }}
                    >
                      <View
                        flexDirection="row"
                        alignItems="center"
                        gap={12}
                        paddingVertical={12}
                        paddingHorizontal={14}
                        borderTopWidth={index > 0 ? 1 : 0}
                        borderTopColor="$border"
                      >
                        <View
                          width={22}
                          height={22}
                          borderRadius={6}
                          alignItems="center"
                          justifyContent="center"
                          backgroundColor={isChecked ? "$gold" : "transparent"}
                          borderWidth={1.5}
                          borderColor={isChecked ? "$gold" : "$border3"}
                        >
                          {isChecked ? (
                            <IconCheck
                              size={12}
                              strokeWidth={3}
                              color={GOLD.ink}
                            />
                          ) : null}
                        </View>
                        <Text
                          flex={1}
                          fontFamily="$body"
                          fontSize={13.5}
                          color={isChecked ? "$text4" : "$text"}
                          textDecorationLine={
                            isChecked ? "line-through" : "none"
                          }
                        >
                          {item.name}
                        </Text>
                        <Text fontFamily="$mono" fontSize={12} color="$text3">
                          {item.quantity}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </Card>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
