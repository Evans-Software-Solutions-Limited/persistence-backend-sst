import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconCheck } from "@/ui/components/icons";
import { FieldInput, FieldLabel, Note } from "@/ui/presenters/coachForms/kit";

/**
 * PER-135 sheets for the coach's meal plans (canvas C1b, C5): Send with a
 * note, Change the note, a list of actions (⋯), a confirm, and a one-of
 * picker (a plan, a client, a recipe). Pure.
 */

export type SendPlanSheetProps = {
  visible: boolean;
  mode: "send" | "note";
  planName: string;
  /** "2,476 / 2,500" once the client and their target are known. */
  versusTarget: string | null;
  clientFirst: string | null;
  /** Library send: tap to choose the client. */
  chooseClientLabel: string | null;
  onChooseClient?: () => void;
  note: string;
  noteError: string | null;
  busy: boolean;
  online: boolean;
  error: string | null;
  canSubmit: boolean;
  onNote: (text: string) => void;
  onSubmit: () => void;
  onClose: () => void;
};

/** C5 Send meal plan (a note only, no days) and C1b Change the note. */
export function SendPlanSheetPresenter(p: SendPlanSheetProps) {
  const send = p.mode === "send";
  const first = p.clientFirst;
  const label = send
    ? p.busy
      ? "Sending…"
      : first
        ? `Send to ${first}`
        : "Send"
    : p.busy
      ? "Saving…"
      : "Save note";
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={send ? "Send meal plan" : "Change the note"}
      eyebrow="Meal plan"
      accent="trainer"
      height="tall"
      testID="send-plan-sheet"
      footer={
        <View paddingHorizontal={20} paddingTop={6}>
          <Btn
            variant="filled"
            tone="trainer"
            size="lg"
            full
            disabled={!p.canSubmit || p.busy || !p.online}
            onPress={p.onSubmit}
            testID="send-plan-submit"
          >
            {label}
          </Btn>
        </View>
      }
    >
      <View paddingHorizontal={20} gap={4}>
        <Text fontFamily="$body" fontWeight="600" fontSize={16} color="$text">
          {p.planName}
        </Text>
        {send && first && p.versusTarget ? (
          <Text fontFamily="$body" fontSize={12.5} color="$text3">
            Plan vs {first}’s target{" "}
            <Text fontFamily="$mono" color="$text2">
              {p.versusTarget}
            </Text>
          </Text>
        ) : null}
        {p.chooseClientLabel !== null && p.onChooseClient ? (
          <>
            <FieldLabel>Send to</FieldLabel>
            <Pressable
              onPress={p.onChooseClient}
              accessibilityRole="button"
              accessibilityLabel={`Send to: ${p.chooseClientLabel}`}
              testID="send-plan-client"
              style={{
                minHeight: 44,
                borderRadius: 12,
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.10)",
                backgroundColor: "#1A1D29",
                paddingHorizontal: 14,
                justifyContent: "center",
              }}
            >
              <Text fontFamily="$body" fontSize={14} color="$text">
                {p.chooseClientLabel}
              </Text>
            </Pressable>
          </>
        ) : null}
        <FieldLabel>{first ? `Note for ${first}` : "Note"}</FieldLabel>
        <FieldInput
          value={p.note}
          onChangeText={p.onNote}
          accessibilityLabel={first ? `Note for ${first}` : "Note"}
          multiline
          testID="send-plan-note"
        />
        {p.noteError ? (
          <Text
            fontFamily="$body"
            fontSize={12}
            color="$error"
            accessibilityRole="alert"
          >
            {p.noteError}
          </Text>
        ) : null}
        {send ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={18}
            color="$text3"
            marginTop={8}
          >
            {first
              ? `It goes into ${first}’s plans with your note. ${first} chooses when to follow it, and nothing is logged for them. Your later edits reach ${first} automatically.`
              : "It goes into your client’s plans with your note. They choose when to follow it, and nothing is logged for them. Your later edits reach them automatically."}
          </Text>
        ) : null}
        {!p.online ? (
          <Note testID="send-plan-offline">
            {send
              ? `You’re offline. Sending needs a connection, so Send${first ? ` to ${first}` : ""} waits until you’re back.`
              : "You’re offline. Changing the note needs a connection."}
          </Note>
        ) : null}
        {p.error ? <Note testID="send-plan-error">{p.error}</Note> : null}
      </View>
    </BottomSheet>
  );
}

export type SheetAction = {
  key: string;
  title: string;
  subtitle?: string;
  danger?: boolean;
  disabled?: boolean;
};

/** C1b ⋯ menu: Edit plan, Change the note, Remove from Sam. */
export function ActionsSheetPresenter(p: {
  visible: boolean;
  title: string;
  actions: readonly SheetAction[];
  onAction: (key: string) => void;
  onClose: () => void;
  testID?: string;
}) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={p.title}
      accent="trainer"
      height="content"
      testID={p.testID ?? "plan-actions-sheet"}
    >
      <View paddingHorizontal={20}>
        {p.actions.map((a) => (
          <Pressable
            key={a.key}
            onPress={() => p.onAction(a.key)}
            disabled={a.disabled}
            accessibilityRole="button"
            accessibilityLabel={a.title}
            accessibilityState={{ disabled: !!a.disabled }}
            testID={`plan-action-${a.key}`}
          >
            <View
              paddingVertical={12}
              borderBottomWidth={1}
              borderBottomColor="$border"
              opacity={a.disabled ? 0.45 : 1}
              gap={2}
            >
              <Text
                fontFamily="$body"
                fontWeight="500"
                fontSize={15}
                color={a.danger ? "$error" : "$text"}
              >
                {a.title}
              </Text>
              {a.subtitle ? (
                <Text fontFamily="$body" fontSize={12} color="$text3">
                  {a.subtitle}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
        <View marginTop={10}>
          <Btn variant="ghost" size="lg" full onPress={p.onClose}>
            Cancel
          </Btn>
        </View>
      </View>
    </BottomSheet>
  );
}

/** "Remove Lean bulk · Training day?" with Cancel / Remove. */
export function ConfirmSheetPresenter(p: {
  visible: boolean;
  title: string;
  body: string;
  confirmLabel: string;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
  testID?: string;
}) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={p.title}
      height="content"
      testID={p.testID ?? "plan-confirm-sheet"}
    >
      <View paddingHorizontal={20}>
        <Text fontFamily="$body" fontSize={14} lineHeight={20} color="$text2">
          {p.body}
        </Text>
      </View>
      <View paddingHorizontal={20} paddingTop={16} gap={8}>
        <Btn
          variant="filled"
          tone="error"
          size="lg"
          full
          disabled={p.busy}
          onPress={p.onConfirm}
          testID="plan-confirm"
        >
          {p.busy ? `${p.confirmLabel}…` : p.confirmLabel}
        </Btn>
        <Btn variant="ghost" size="lg" full onPress={p.onClose}>
          Cancel
        </Btn>
      </View>
    </BottomSheet>
  );
}

export type PickOption = {
  id: string;
  title: string;
  subtitle?: string;
  right?: string;
  disabled?: boolean;
};

/** Pick one: a library plan, a client or a recipe. */
export function PickerSheetPresenter(p: {
  visible: boolean;
  title: string;
  options: readonly PickOption[] | null;
  empty: string;
  selectedId?: string | null;
  error?: string | null;
  footerLabel?: string;
  onFooter?: () => void;
  onPick: (id: string) => void;
  onClose: () => void;
  testID?: string;
}) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={p.title}
      accent="trainer"
      height="default"
      scrollable
      testID={p.testID ?? "plan-picker-sheet"}
      footer={
        p.footerLabel && p.onFooter ? (
          <View paddingHorizontal={20} paddingTop={6}>
            <Btn
              variant="outline"
              tone="trainer"
              size="lg"
              full
              onPress={p.onFooter}
              testID="plan-picker-footer"
            >
              {p.footerLabel}
            </Btn>
          </View>
        ) : undefined
      }
    >
      <View paddingHorizontal={20}>
        {p.error ? <Note testID="plan-picker-error">{p.error}</Note> : null}
        {p.options === null ? (
          <Text fontFamily="$body" fontSize={13} color="$text3">
            Loading…
          </Text>
        ) : p.options.length === 0 ? (
          <Text fontFamily="$body" fontSize={13} color="$text3">
            {p.empty}
          </Text>
        ) : (
          p.options.map((o) => (
            <Pressable
              key={o.id}
              onPress={() => p.onPick(o.id)}
              disabled={o.disabled}
              accessibilityRole="button"
              accessibilityLabel={o.title}
              accessibilityState={{
                disabled: !!o.disabled,
                selected: p.selectedId === o.id,
              }}
              testID={`plan-pick-${o.id}`}
            >
              <View
                flexDirection="row"
                alignItems="center"
                gap={10}
                paddingVertical={12}
                borderBottomWidth={1}
                borderBottomColor="$border"
                opacity={o.disabled ? 0.45 : 1}
              >
                <View flex={1} gap={2}>
                  <Text fontFamily="$body" fontSize={15} color="$text">
                    {o.title}
                  </Text>
                  {o.subtitle ? (
                    <Text fontFamily="$body" fontSize={12} color="$text3">
                      {o.subtitle}
                    </Text>
                  ) : null}
                </View>
                {o.right ? (
                  <Text fontFamily="$mono" fontSize={12.5} color="$text2">
                    {o.right}
                  </Text>
                ) : null}
                {p.selectedId === o.id ? (
                  <IconCheck size={16} color="#A78BFA" />
                ) : null}
              </View>
            </Pressable>
          ))
        )}
      </View>
    </BottomSheet>
  );
}
