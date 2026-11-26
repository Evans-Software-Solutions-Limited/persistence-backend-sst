import { useEffect, type ReactNode } from "react";
import { useForm } from "react-hook-form";
import {
  planNameAccepts,
  planNameResolver,
  type PlanNameValues,
} from "@/ui/forms/planForms";
import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Copy } from "lucide-react-native";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconChevronR, IconX } from "@/ui/components/icons";
import { PLAN_NAME_MAX } from "@/domain/models/nutritionPlans";
import { SheetTitle } from "./PlanChrome";

/**
 * <PlanOptionsSheetPresenter> — canvas N34 (PER-133): the edit screen's ⋯
 * menu (Rename · Target · Meals · Duplicate · Delete plan · Cancel) and the
 * delete confirm ("Delete <name>?"). Plans have no days, so the canvas's
 * "Days it runs" row and "It comes off …" line are left out.
 *
 * Rename opens a small name field in the same sheet.
 *
 * Pure: `view` says which part shows; the container owns it.
 */

export type PlanOptionsView = "menu" | "rename" | "delete" | null;

export type PlanOptionsSheetProps = {
  view: PlanOptionsView;
  onClose: () => void;
  planName: string;
  /** "2,371", or "—" without a target. */
  targetValue: string;
  mealsText: string;
  onStartRename: () => void;
  onRename: (name: string) => void;
  onTarget: () => void;
  onMeals: () => void;
  onDuplicate: () => void;
  onAskDelete: () => void;
  onDelete: () => void;
  testID?: string;
};

function Option({
  title,
  sub,
  icon,
  right,
  onPress,
  destructive = false,
  last = false,
  testID,
}: {
  title: string;
  sub?: string;
  icon?: ReactNode;
  right?: ReactNode;
  onPress: () => void;
  destructive?: boolean;
  last?: boolean;
  testID: string;
}) {
  return (
    <Pressable onPress={onPress} accessibilityRole="button" testID={testID}>
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={10}
        borderBottomWidth={last ? 0 : 1}
        borderColor="$border"
      >
        {icon}
        <View flex={1} gap={2}>
          <Text
            fontFamily="$body"
            fontSize={15}
            fontWeight="500"
            color={destructive ? "$error" : "$text"}
          >
            {title}
          </Text>
          {sub ? (
            <Text fontFamily="$body" fontSize={12} color="$text3">
              {sub}
            </Text>
          ) : null}
        </View>
        {right}
      </View>
    </Pressable>
  );
}

export function PlanOptionsSheetPresenter({
  view,
  onClose,
  planName,
  targetValue,
  mealsText,
  onStartRename,
  onRename,
  onTarget,
  onMeals,
  onDuplicate,
  onAskDelete,
  onDelete,
  testID = "plan-options",
}: PlanOptionsSheetProps) {
  // Rename is a react-hook-form (PER-147): Save is on while the schema
  // accepts the name, and saving goes through the resolver.
  const form = useForm<PlanNameValues>({
    resolver: planNameResolver,
    defaultValues: { name: planName },
  });
  const draftName = form.watch("name");
  const { reset } = form;
  useEffect(() => {
    if (view === "rename") reset({ name: planName });
  }, [view, planName, reset]);
  const canRename = planNameAccepts({ name: draftName });
  const rename = () =>
    void form.handleSubmit(({ name }) => onRename(name.trim()))();

  return (
    <>
      <BottomSheet
        visible={view === "menu" || view === "rename"}
        onClose={onClose}
        height="content"
        testID={testID}
      >
        {view === "rename" ? (
          <View gap={14}>
            <SheetTitle>Rename</SheetTitle>
            <TextInput
              value={draftName}
              onChangeText={(v) =>
                form.setValue("name", v, { shouldDirty: true })
              }
              onSubmitEditing={rename}
              autoFocus
              maxLength={PLAN_NAME_MAX}
              returnKeyType="done"
              accessibilityLabel="Name"
              testID={`${testID}-name`}
              style={{
                height: 48,
                paddingHorizontal: 14,
                borderRadius: 12,
                backgroundColor: "#1A1D29",
                borderWidth: 1,
                borderColor: "rgba(34,211,238,0.55)",
                color: "#F4F4F8",
                fontSize: 15,
                fontWeight: "600",
              }}
            />
            <Btn
              variant="filled"
              tone="primary"
              size="lg"
              full
              disabled={!canRename}
              onPress={rename}
              testID={`${testID}-rename-save`}
            >
              Save
            </Btn>
          </View>
        ) : (
          <View>
            <SheetTitle>{planName}</SheetTitle>
            <Option
              title="Rename"
              onPress={onStartRename}
              testID={`${testID}-rename`}
            />
            <Option
              title="Target"
              sub="Opens your targets calculator"
              onPress={onTarget}
              testID={`${testID}-target`}
              right={
                <View flexDirection="row" alignItems="center" gap={6}>
                  <Text fontFamily="$mono" fontSize={14} color="$text">
                    {targetValue}
                  </Text>
                  <IconChevronR size={16} color="#5C5C68" />
                </View>
              }
            />
            <Option
              title="Meals"
              sub={mealsText}
              onPress={onMeals}
              testID={`${testID}-meals`}
            />
            <Option
              title="Duplicate"
              icon={<Copy size={20} color="#22D3EE" />}
              onPress={onDuplicate}
              testID={`${testID}-duplicate`}
            />
            <Option
              title="Delete plan"
              icon={<IconX size={20} color="#F87171" />}
              destructive
              last
              onPress={onAskDelete}
              testID={`${testID}-delete`}
            />
            <View marginTop={14}>
              <Btn
                variant="outline"
                tone="primary"
                size="lg"
                full
                onPress={onClose}
                testID={`${testID}-cancel`}
              >
                Cancel
              </Btn>
            </View>
          </View>
        )}
      </BottomSheet>

      <BottomSheet
        visible={view === "delete"}
        onClose={onClose}
        height="content"
        testID={`${testID}-confirm`}
      >
        <View gap={14}>
          <SheetTitle size={21}>{`Delete ${planName}?`}</SheetTitle>
          <Text fontFamily="$body" fontSize={14} color="$text2">
            Food you have already logged stays in your diary.
          </Text>
          <View flexDirection="row" gap={10}>
            <View flex={1}>
              <Btn
                variant="outline"
                tone="primary"
                size="lg"
                full
                onPress={onClose}
                testID={`${testID}-confirm-cancel`}
              >
                Cancel
              </Btn>
            </View>
            <View flex={1.3}>
              <Btn
                variant="filled"
                tone="error"
                size="lg"
                full
                onPress={onDelete}
                testID={`${testID}-confirm-delete`}
              >
                Delete
              </Btn>
            </View>
          </View>
        </View>
      </BottomSheet>
    </>
  );
}
