import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { toneHex } from "@/ui/components/foundation/tones";
import { Image } from "expo-image";
import { Utensils } from "lucide-react-native";
import { IconPlus, IconSearch } from "@/ui/components/icons";
import { MACRO_HEX } from "./FuelLogSummaryPresenter";

/**
 * <MealsTabPresenter> — canvas N11 / N12 "Meals" (PER-133): what sits under
 * the Fuel title and the Log · Plan · Meals switch when Meals is picked.
 * A search box, the Saved meals · Recipes · Foods chips, the list's eyebrow
 * and its rows (photo tile, name, sub line, C/F/P chips, kcal, "+").
 *
 * Renders a plain View: the Fuel screen owns the ScrollView, the header
 * (with the "New meal or recipe" button) and the tab bar.
 */

export type MealsLibrary = "saved" | "recipes" | "foods";

export type MealsTabRowVM = {
  key: string;
  name: string;
  /** "4 foods", "My recipe · 2 portions", "85 g". May be "". */
  sub: string;
  photoUrl: string | null;
  /** Null when the recipe's totals aren't known yet. */
  kcal: number | null;
  carbsG: number | null;
  fatG: number | null;
  proteinG: number | null;
  /** False for a food: there is no food detail page. */
  canOpen: boolean;
};

export type MealsTabPresenterProps = {
  query: string;
  onQuery: (query: string) => void;
  library: MealsLibrary;
  onLibrary: (library: MealsLibrary) => void;
  /** Rows of the picked chip, already filtered by the search. */
  rows: readonly MealsTabRowVM[];
  onOpen: (key: string) => void;
  onLog: (key: string) => void;
  /** The row being logged right now (its + is disabled), or null. */
  loggingKey: string | null;
  testID?: string;
};

const CHIPS: { key: MealsLibrary; label: string }[] = [
  { key: "saved", label: "Saved meals" },
  { key: "recipes", label: "Recipes" },
  { key: "foods", label: "Foods" },
];

const EYEBROW: Record<MealsLibrary, string> = {
  saved: "Saved meals · used most",
  recipes: "Recipes",
  foods: "Foods · recent",
};

const EMPTY: Record<MealsLibrary, string> = {
  saved: "No saved meals yet.",
  recipes: "No recipes yet.",
  foods: "No foods logged in the last two weeks.",
};

const CYAN = "$primary";
const CYAN_HEX = toneHex("primary").base;
const fmt = (n: number) => Math.round(n).toLocaleString("en-GB");

function MacroChip({
  grams,
  unit,
  hex,
}: {
  grams: number;
  unit: string;
  hex: string;
}) {
  return (
    <View
      height={22}
      paddingHorizontal={8}
      borderRadius={9999}
      justifyContent="center"
      backgroundColor={`${hex}1F`}
    >
      <Text fontFamily="$mono" fontSize={11} fontWeight="600" color={hex}>
        {`${fmt(grams)}g ${unit}`}
      </Text>
    </View>
  );
}

function PhotoTile({ uri, testID }: { uri: string | null; testID: string }) {
  return (
    <View
      width={56}
      height={56}
      borderRadius={14}
      overflow="hidden"
      alignItems="center"
      justifyContent="center"
      backgroundColor="$surface3"
      aria-hidden
      testID={testID}
    >
      {uri ? (
        <Image
          source={{ uri }}
          style={{ width: 56, height: 56 }}
          contentFit="cover"
          testID={`${testID}-image`}
        />
      ) : (
        <View testID={`${testID}-icon`}>
          <Utensils size={20} color="#5C5C68" strokeWidth={1.75} />
        </View>
      )}
    </View>
  );
}

function Row({
  row,
  onOpen,
  onLog,
  logging,
}: {
  row: MealsTabRowVM;
  onOpen: (key: string) => void;
  onLog: (key: string) => void;
  logging: boolean;
}) {
  const hasMacros =
    row.carbsG !== null && row.fatG !== null && row.proteinG !== null;
  return (
    <View
      flexDirection="row"
      alignItems="center"
      gap={12}
      paddingVertical={10}
      borderBottomWidth={1}
      borderColor="$border"
      testID={`meals-row-${row.key}`}
    >
      <PhotoTile uri={row.photoUrl} testID={`meals-photo-${row.key}`} />
      <Pressable
        style={{ flex: 1, minWidth: 0 }}
        onPress={() => onOpen(row.key)}
        disabled={!row.canOpen}
        accessibilityRole={row.canOpen ? "button" : undefined}
        accessibilityLabel={row.name}
        testID={`meals-open-${row.key}`}
      >
        <View gap={5}>
          <Text
            fontFamily="$body"
            fontSize={15}
            fontWeight="600"
            color="$text"
            numberOfLines={1}
          >
            {row.name}
          </Text>
          {row.sub ? (
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$text3"
              numberOfLines={1}
            >
              {row.sub}
            </Text>
          ) : null}
          {hasMacros ? (
            <View flexDirection="row" gap={6}>
              <MacroChip
                grams={row.carbsG ?? 0}
                unit="C"
                hex={MACRO_HEX.carbs}
              />
              <MacroChip grams={row.fatG ?? 0} unit="F" hex={MACRO_HEX.fat} />
              <MacroChip
                grams={row.proteinG ?? 0}
                unit="P"
                hex={MACRO_HEX.protein}
              />
            </View>
          ) : null}
        </View>
      </Pressable>
      <View alignItems="flex-end" gap={8}>
        <Text fontFamily="$mono" fontSize={14} fontWeight="600" color="$text">
          {row.kcal === null ? "—" : fmt(row.kcal)}
        </Text>
        <Pressable
          onPress={() => onLog(row.key)}
          disabled={logging}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel={`Log ${row.name}`}
          accessibilityState={{ disabled: logging }}
          testID={`meals-log-${row.key}`}
        >
          <View
            width={32}
            height={32}
            borderRadius={10}
            alignItems="center"
            justifyContent="center"
            backgroundColor="$surface2"
            borderWidth={1}
            borderColor="$border"
            opacity={logging ? 0.5 : 1}
          >
            <IconPlus size={16} color={CYAN_HEX} />
          </View>
        </Pressable>
      </View>
    </View>
  );
}

export function MealsTabPresenter({
  query,
  onQuery,
  library,
  onLibrary,
  rows,
  onOpen,
  onLog,
  loggingKey,
  testID = "meals-tab",
}: MealsTabPresenterProps) {
  return (
    <View testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={10}
        height={46}
        marginTop={14}
        paddingHorizontal={14}
        borderRadius={14}
        backgroundColor="$surface"
        borderWidth={1}
        borderColor="$border"
      >
        <IconSearch size={16} color="#8A8A98" />
        <TextInput
          value={query}
          onChangeText={onQuery}
          placeholder="Search meals, recipes and foods"
          placeholderTextColor="#8A8A98"
          returnKeyType="search"
          autoCorrect={false}
          accessibilityLabel="Search meals, recipes and foods"
          testID={`${testID}-search`}
          style={{
            flex: 1,
            height: 46,
            color: "#F4F4F8",
            fontSize: 15,
            fontFamily: "Geist",
          }}
        />
      </View>

      <View
        flexDirection="row"
        gap={8}
        marginTop={12}
        accessibilityRole="tablist"
        aria-label="Library"
      >
        {CHIPS.map((c) => {
          const on = c.key === library;
          return (
            <Pressable
              key={c.key}
              onPress={() => onLibrary(c.key)}
              accessibilityRole="tab"
              accessibilityState={{ selected: on }}
              testID={`${testID}-chip-${c.key}`}
            >
              <View
                height={32}
                paddingHorizontal={12}
                borderRadius={9999}
                justifyContent="center"
                borderWidth={1}
                borderColor={on ? "rgba(34,211,238,0.4)" : "$border"}
                backgroundColor={on ? "rgba(34,211,238,0.12)" : "$surface"}
              >
                <Text
                  fontFamily="$body"
                  fontSize={12}
                  fontWeight="600"
                  color={on ? CYAN : "$text2"}
                >
                  {c.label}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <Text
        marginTop={18}
        fontFamily="$display"
        fontSize={11}
        fontWeight="600"
        letterSpacing={2.6}
        textTransform="uppercase"
        color="$text3"
        testID={`${testID}-eyebrow`}
      >
        {EYEBROW[library]}
      </Text>

      {rows.length === 0 ? (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          paddingVertical={16}
          testID={`${testID}-empty`}
        >
          {query.trim() ? `Nothing matches “${query.trim()}”.` : EMPTY[library]}
        </Text>
      ) : (
        rows.map((r) => (
          <Row
            key={r.key}
            row={r}
            onOpen={onOpen}
            onLog={onLog}
            logging={loggingKey === r.key}
          />
        ))
      )}
    </View>
  );
}
