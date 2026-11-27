import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import { IconBasket, IconCalendar, IconCheck } from "@/ui/components/icons";
import { PLAN_NAME_MAX } from "@/domain/models/nutritionPlans";
import { CloseBtn } from "@/ui/presenters/fuel/plans/PlanChrome";
import {
  BigIcon,
  MACRO_COLOURS,
  MealprintPage,
  MealprintTitle,
  StatStrip,
  fmtKcal,
} from "./MealprintChrome";

/**
 * The two ways out of a Mealprint day (PER-134), both pure:
 *
 * - <MealprintSavedPresenter> — canvas N21 "Saved to your plans": the plan
 *   is under Mine in Plan, its name can be changed here, then View in Plan
 *   or Add to shopping list. Plans have no days (product rule, 18 Nov), so
 *   the canvas's "Use on" day chips and their note are left out.
 * - <MealprintLoggedPresenter> — canvas N22 "N meals logged": what went into
 *   today's Log, what was skipped because it already had food, Eaten ·
 *   Target · Left, then View in Log or Undo.
 */

export type MealprintSavedProps = {
  name: string;
  onName: (name: string) => void;
  onNameDone: () => void;
  nameError: string | null;
  mealCount: number;
  kcal: number;
  proteinG: number;
  onClose: () => void;
  onViewInPlan: () => void;
  onShoppingList: () => void;
  /** True once the plan is on the shopping list. */
  inShoppingList: boolean;
  shoppingBusy: boolean;
  testID?: string;
};

export function MealprintSavedPresenter(p: MealprintSavedProps) {
  const testID = p.testID ?? "mealprint-saved";
  return (
    <MealprintPage
      testID={testID}
      left={null}
      eyebrow="Mealprint"
      right={<CloseBtn onPress={p.onClose} testID={`${testID}-close`} />}
      footer={
        <>
          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            onPress={p.onViewInPlan}
            testID={`${testID}-view`}
          >
            View in Plan
          </Btn>
          <Btn
            variant="outline"
            tone="primary"
            size="lg"
            full
            icon={<IconBasket size={16} color="#F4F4F8" />}
            disabled={p.shoppingBusy}
            onPress={p.onShoppingList}
            testID={`${testID}-shopping`}
          >
            {p.inShoppingList ? "View shopping list" : "Add to shopping list"}
          </Btn>
        </>
      }
    >
      <BigIcon>
        <IconCalendar size={38} color="#22D3EE" />
      </BigIcon>
      <MealprintTitle center marginTop={24}>
        Saved to your plans
      </MealprintTitle>
      <Text
        marginTop={8}
        textAlign="center"
        fontFamily="$body"
        fontSize={14}
        lineHeight={20}
        color="$text2"
      >
        Under Mine in Plan. Add its meals to today from Plan whenever you like.
      </Text>
      <View
        marginTop={22}
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingVertical={10}
        borderBottomWidth={1}
        borderColor="$border"
      >
        <Text fontFamily="$body" fontSize={15} fontWeight="500" color="$text">
          Name
        </Text>
        <TextInput
          value={p.name}
          onChangeText={p.onName}
          onSubmitEditing={p.onNameDone}
          onBlur={p.onNameDone}
          maxLength={PLAN_NAME_MAX}
          returnKeyType="done"
          accessibilityLabel="Name"
          testID={`${testID}-name`}
          style={{
            height: 40,
            minWidth: 200,
            paddingHorizontal: 14,
            borderRadius: 12,
            backgroundColor: "#1A1D29",
            borderWidth: 1,
            borderColor: p.nameError ? "#F87171" : "rgba(255,255,255,0.08)",
            color: "#F4F4F8",
            fontSize: 15,
            fontWeight: "600",
            textAlign: "right",
          }}
        />
      </View>
      {p.nameError ? (
        <Text
          marginTop={6}
          fontFamily="$body"
          fontSize={12}
          color="$error"
          textAlign="right"
          testID={`${testID}-name-error`}
        >
          {p.nameError}
        </Text>
      ) : null}
      <StatStrip
        marginTop={20}
        cells={[
          { value: String(p.mealCount), label: "Meals" },
          { value: fmtKcal(p.kcal), label: "kcal" },
          {
            value: `${Math.round(p.proteinG)}g`,
            label: "Protein",
            colour: MACRO_COLOURS.protein,
          },
        ]}
      />
    </MealprintPage>
  );
}

export type LoggedRowVM = {
  key: string;
  mealName: string;
  /** The dish, or "Skipped · already has food". */
  detail: string;
  kcal: number | null;
  skipped: boolean;
};

export type MealprintLoggedProps = {
  loggedCount: number;
  /** "Breakfast and Snacks", or null when nothing was skipped. */
  skippedNames: string | null;
  rows: readonly LoggedRowVM[];
  eatenKcal: number;
  targetKcal: number | null;
  onClose: () => void;
  onViewInLog: () => void;
  onUndo: () => void;
  undoing: boolean;
  /** Set after Undo: "Removed from today's Log." */
  undone: boolean;
  testID?: string;
};

export function MealprintLoggedPresenter(p: MealprintLoggedProps) {
  const testID = p.testID ?? "mealprint-logged";
  const title = p.undone
    ? "Undone"
    : `${p.loggedCount} ${p.loggedCount === 1 ? "meal" : "meals"} logged`;
  const body = p.undone
    ? "Those meals are off today's Log."
    : p.skippedNames
      ? `Added to today's Log. ${p.skippedNames} already had food, so we left ${p.skippedNames.includes(" and ") ? "them" : "it"} alone.`
      : "Added to today's Log.";
  const left = p.targetKcal === null ? null : p.targetKcal - p.eatenKcal;
  return (
    <MealprintPage
      testID={testID}
      left={null}
      eyebrow="Mealprint"
      right={<CloseBtn onPress={p.onClose} testID={`${testID}-close`} />}
      footer={
        <>
          <Btn
            variant="filled"
            tone="primary"
            size="lg"
            full
            onPress={p.onViewInLog}
            testID={`${testID}-view`}
          >
            View in Log
          </Btn>
          {p.undone ? null : (
            <Btn
              variant="ghost"
              tone="primary"
              size="lg"
              full
              disabled={p.undoing}
              onPress={p.onUndo}
              testID={`${testID}-undo`}
            >
              Undo
            </Btn>
          )}
        </>
      }
    >
      <BigIcon tone="success">
        <IconCheck size={38} color="#34D399" />
      </BigIcon>
      <MealprintTitle center marginTop={24}>
        {title}
      </MealprintTitle>
      <Text
        marginTop={8}
        textAlign="center"
        fontFamily="$body"
        fontSize={14}
        lineHeight={20}
        color="$text2"
        testID={`${testID}-body`}
      >
        {body}
      </Text>
      <View marginTop={22} borderTopWidth={1} borderColor="$border">
        {p.rows.map((r) => (
          <View
            key={r.key}
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={10}
            borderBottomWidth={1}
            borderColor="$border"
            testID={`${testID}-row-${r.key}`}
          >
            <Text
              width={24}
              textAlign="center"
              fontFamily="$body"
              fontSize={15}
              fontWeight="700"
              color={r.skipped || p.undone ? "$text4" : "$success"}
            >
              {r.skipped ? "–" : "✓"}
            </Text>
            <View flex={1} gap={2}>
              <Text
                fontFamily="$body"
                fontSize={15}
                fontWeight="500"
                color={r.skipped ? "$text3" : "$text"}
              >
                {r.mealName}
              </Text>
              <Text fontFamily="$body" fontSize={12} color="$text3">
                {r.detail}
              </Text>
            </View>
            <Text
              fontFamily="$mono"
              fontSize={14}
              fontWeight="600"
              color={r.skipped ? "$text3" : "$text"}
            >
              {r.kcal === null ? "—" : fmtKcal(r.kcal)}
            </Text>
          </View>
        ))}
      </View>
      <StatStrip
        marginTop={18}
        cells={[
          { value: fmtKcal(p.eatenKcal), label: "Eaten" },
          {
            value: p.targetKcal === null ? "—" : fmtKcal(p.targetKcal),
            label: "Target",
            colour: "$text2",
          },
          {
            value: left === null ? "—" : fmtKcal(Math.abs(left)),
            label: left !== null && left < 0 ? "Over" : "Left",
            colour: left !== null && left < 0 ? "$error" : "$primary",
          },
        ]}
      />
    </MealprintPage>
  );
}
