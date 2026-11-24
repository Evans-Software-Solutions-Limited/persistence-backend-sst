import type { ReactNode } from "react";
import { Pressable, RefreshControl, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { CalendarCheck } from "lucide-react-native";
import { Btn } from "@/ui/components/foundation";
import { IconCheck, IconChevronL, IconPlus } from "@/ui/components/icons";

/**
 * <PlansShoppingListPresenter> — canvas N23 "Shopping list · new scope"
 * (PER-133): one list across every plan the person added. Plan chips at the
 * top, "<done> of <total> items" with a green bar, then the aisles, each row
 * a 24pt tick box, the name and the amount. Ticks stay on the phone.
 *
 * Left out: the canvas's grey "from" line under merged rows (which meals and
 * plans an item came from) — the server sends `{id, name, quantity}` only.
 *
 * Pure: the container owns the list, the ticks and the navigation.
 */

export type PlansShoppingChipVM = { key: string; label: string };

export type PlansShoppingRowVM = {
  id: string;
  name: string;
  quantity: string;
  ticked: boolean;
};

export type PlansShoppingAisleVM = {
  aisle: string;
  items: readonly PlansShoppingRowVM[];
};

/**
 * - `loading`: first read, nothing cached yet.
 * - `offline`: offline and nothing cached yet.
 * - `error`: the read failed and nothing is cached.
 * - `empty`: no plans in the list.
 * - `list`: the list (cached or fresh).
 */
export type PlansShoppingView =
  | "loading"
  | "offline"
  | "error"
  | "empty"
  | "list";

export type PlansShoppingListProps = {
  view: PlansShoppingView;
  chips: readonly PlansShoppingChipVM[];
  done: number;
  total: number;
  aisles: readonly PlansShoppingAisleVM[];
  refreshing: boolean;
  onRefresh: () => void;
  onToggle: (itemId: string) => void;
  onBack: () => void;
  onAdd: () => void;
  onRetry: () => void;
  /** The add-a-plan sheet, rendered over the page. */
  sheet?: ReactNode;
  testID?: string;
};

function RoundBtn({
  label,
  onPress,
  testID,
  children,
}: {
  label: string;
  onPress: () => void;
  testID: string;
  children: ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      testID={testID}
    >
      <View
        width={44}
        height={44}
        borderRadius={9999}
        backgroundColor="rgba(255,255,255,0.06)"
        borderWidth={1}
        borderColor="rgba(255,255,255,0.08)"
        alignItems="center"
        justifyContent="center"
      >
        {children}
      </View>
    </Pressable>
  );
}

function Row({
  row,
  onToggle,
}: {
  row: PlansShoppingRowVM;
  onToggle: (id: string) => void;
}) {
  return (
    <Pressable
      onPress={() => onToggle(row.id)}
      accessibilityRole="checkbox"
      accessibilityState={{ checked: row.ticked }}
      accessibilityLabel={`${row.name}, ${row.quantity}`}
      testID={`plans-shopping-item-${row.id}`}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        minHeight={44}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <View
          width={24}
          height={24}
          borderRadius={7}
          alignItems="center"
          justifyContent="center"
          backgroundColor={row.ticked ? "$success" : "transparent"}
          borderWidth={row.ticked ? 0 : 1.5}
          borderColor="$text4"
          testID={`plans-shopping-box-${row.id}`}
        >
          {row.ticked ? (
            <IconCheck size={14} strokeWidth={3} color="#04261A" />
          ) : null}
        </View>
        <View flex={1} paddingVertical={5}>
          <Text
            fontFamily="$body"
            fontSize={15}
            lineHeight={20}
            fontWeight="500"
            color={row.ticked ? "$text4" : "$text"}
            textDecorationLine={row.ticked ? "line-through" : "none"}
          >
            {row.name}
          </Text>
        </View>
        <Text
          fontFamily="$mono"
          fontSize={13}
          lineHeight={18}
          fontWeight="500"
          color="$text3"
        >
          {row.quantity}
        </Text>
      </View>
    </Pressable>
  );
}

function Message({
  title,
  body,
  action,
  testID,
}: {
  title: string;
  body: string;
  action?: { label: string; onPress: () => void; testID: string };
  testID: string;
}) {
  return (
    <View paddingTop={48} gap={8} alignItems="center" testID={testID}>
      <Text
        fontFamily="$display"
        fontSize={17}
        fontWeight="700"
        color="$text"
        textAlign="center"
      >
        {title}
      </Text>
      <Text
        fontFamily="$body"
        fontSize={14}
        lineHeight={20}
        color="$text3"
        textAlign="center"
      >
        {body}
      </Text>
      {action ? (
        <View marginTop={16} alignSelf="stretch">
          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            onPress={action.onPress}
            testID={action.testID}
          >
            {action.label}
          </Btn>
        </View>
      ) : null}
    </View>
  );
}

export function PlansShoppingListPresenter({
  view,
  chips,
  done,
  total,
  aisles,
  refreshing,
  onRefresh,
  onToggle,
  onBack,
  onAdd,
  onRetry,
  sheet,
  testID = "plans-shopping",
}: PlansShoppingListProps) {
  const insets = useSafeAreaInsets();
  const pct = total > 0 ? Math.min(100, (done / total) * 100) : 0;

  let body: ReactNode;
  if (view === "loading") {
    body = (
      <Text
        fontFamily="$body"
        fontSize={14}
        color="$text3"
        paddingTop={48}
        textAlign="center"
        testID={`${testID}-loading`}
      >
        Loading your shopping list…
      </Text>
    );
  } else if (view === "offline") {
    body = (
      <Message
        title="You're offline"
        body="Your shopping list will show here once you're back online."
        testID={`${testID}-offline`}
      />
    );
  } else if (view === "error") {
    body = (
      <Message
        title="Couldn't load your shopping list"
        body="Check your connection and try again."
        action={{
          label: "Try again",
          onPress: onRetry,
          testID: `${testID}-retry`,
        }}
        testID={`${testID}-error`}
      />
    );
  } else if (view === "empty") {
    body = (
      <Message
        title="No plans in your list yet"
        body="Add a plan and everything it needs shows here, grouped by aisle."
        action={{
          label: "Add a plan",
          onPress: onAdd,
          testID: `${testID}-empty-add`,
        }}
        testID={`${testID}-empty`}
      />
    );
  } else {
    body = (
      <>
        <View flexDirection="row" flexWrap="wrap" gap={6}>
          {chips.map((c) => (
            <View
              key={c.key}
              height={30}
              paddingHorizontal={12}
              borderRadius={9999}
              borderWidth={1}
              borderColor="$border2"
              backgroundColor="$surface"
              flexDirection="row"
              alignItems="center"
              gap={6}
              testID={`${testID}-chip-${c.key}`}
            >
              <CalendarCheck size={14} color="#22D3EE" strokeWidth={1.75} />
              <Text
                fontFamily="$body"
                fontSize={12}
                fontWeight="600"
                color="$text"
              >
                {c.label}
              </Text>
            </View>
          ))}
        </View>
        <View
          flexDirection="row"
          alignItems="baseline"
          marginTop={10}
          testID={`${testID}-progress`}
        >
          <Text
            fontFamily="$mono"
            fontSize={52}
            lineHeight={56}
            fontWeight="700"
            letterSpacing={-2}
            color="$text"
            testID={`${testID}-done`}
          >
            {done}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={15}
            lineHeight={20}
            fontWeight="500"
            color="$text3"
            marginLeft={8}
          >
            of {total} items
          </Text>
        </View>
        <View
          height={6}
          marginTop={6}
          borderRadius={9999}
          backgroundColor="$surface3"
          overflow="hidden"
        >
          <View
            height={6}
            borderRadius={9999}
            width={`${pct}%`}
            backgroundColor="$success"
            testID={`${testID}-bar`}
          />
        </View>
        {total === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={14}
            color="$text3"
            marginTop={16}
            testID={`${testID}-nothing`}
          >
            Nothing to buy yet. Your plans&apos; foods show here once
            they&apos;re in.
          </Text>
        ) : null}
        {aisles.map((a) => (
          <View key={a.aisle} testID={`${testID}-aisle-${a.aisle}`}>
            <Text
              fontFamily="$body"
              fontSize={11}
              lineHeight={14}
              fontWeight="600"
              letterSpacing={2.4}
              textTransform="uppercase"
              color="$text3"
              marginTop={16}
              marginBottom={2}
            >
              {a.aisle}
            </Text>
            {a.items.map((row) => (
              <Row key={row.id} row={row} onToggle={onToggle} />
            ))}
          </View>
        ))}
      </>
    );
  }

  return (
    <View
      flex={1}
      backgroundColor="$bg"
      paddingTop={insets.top}
      testID={testID}
    >
      <View
        height={52}
        paddingHorizontal={16}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
      >
        <RoundBtn label="Back" onPress={onBack} testID={`${testID}-back`}>
          <IconChevronL size={20} color="#F4F4F8" strokeWidth={1.75} />
        </RoundBtn>
        <Text
          fontFamily="$body"
          fontSize={11}
          lineHeight={14}
          fontWeight="600"
          letterSpacing={2.6}
          textTransform="uppercase"
          color="$text3"
          accessibilityRole="header"
        >
          Shopping list
        </Text>
        <RoundBtn label="Add a plan" onPress={onAdd} testID={`${testID}-add`}>
          <IconPlus size={20} color="#F4F4F8" strokeWidth={1.75} />
        </RoundBtn>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: 20,
          paddingBottom: 140,
        }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor="#8A8A98"
          />
        }
        testID={`${testID}-scroll`}
      >
        {body}
      </ScrollView>
      {sheet}
    </View>
  );
}
