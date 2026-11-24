import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import { BottomSheet, Btn } from "@/ui/components/foundation";
import type {
  ClientTrigger,
  FormTrigger,
  RuleFields,
} from "@/domain/models/coachForms";
import { FieldLabel, ListRow, OfflineNote, SegRow } from "./kit";
import { RuleFieldsPresenter } from "./RuleFieldsPresenter";

/**
 * C10j — set a form up for one client (from C3.3b "Sent to"): When (once /
 * weekly / daily; a join or end-of-coaching form keeps its cadence), day,
 * time, due, reminders, then Pause · Stop · Save. For this client only.
 */
export type ClientSetupSheetPresenterProps = {
  visible: boolean;
  onClose: () => void;
  firstName: string;
  formTitle: string;
  status: string;
  /** null when the form's cadence can't change for one client. */
  clientTrigger: ClientTrigger | null;
  onClientTrigger: (t: ClientTrigger) => void;
  trigger: FormTrigger;
  rule: RuleFields;
  onRule: (rule: RuleFields) => void;
  paused: boolean;
  canSave: boolean;
  offline: boolean;
  onPause: () => void;
  onStop: () => void;
  onSave: () => void;
};

export function ClientSetupSheetPresenter(p: ClientSetupSheetPresenterProps) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      eyebrow={`For ${p.firstName} only`}
      title={p.formTitle}
      accent="trainer"
      height="tall"
      testID="client-setup-sheet"
      footer={
        <View flexDirection="row" gap={8} paddingHorizontal={20} paddingTop={6}>
          <Pressable
            style={{ flex: 1 }}
            onPress={p.onPause}
            accessibilityRole="button"
            testID="client-setup-pause"
          >
            <View
              height={52}
              borderRadius={14}
              borderWidth={1}
              borderColor="$border3"
              alignItems="center"
              justifyContent="center"
            >
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={14}
                color="$text"
              >
                {p.paused ? "Resume" : "Pause"}
              </Text>
            </View>
          </Pressable>
          <Pressable
            style={{ flex: 1 }}
            onPress={p.onStop}
            accessibilityRole="button"
            testID="client-setup-stop"
          >
            <View
              height={52}
              borderRadius={14}
              borderWidth={1}
              borderColor="$border3"
              alignItems="center"
              justifyContent="center"
            >
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={14}
                color="#FCA5A5"
              >
                Stop
              </Text>
            </View>
          </Pressable>
          <View flex={1.4}>
            <Btn
              variant="filled"
              tone="trainer"
              size="lg"
              full
              disabled={!p.canSave}
              onPress={p.onSave}
              testID="client-setup-save"
            >
              Save
            </Btn>
          </View>
        </View>
      }
    >
      <Text
        fontFamily="$body"
        fontSize={13}
        color="$text3"
        testID="client-setup-status"
      >
        {p.status}
      </Text>
      {p.offline ? <OfflineNote testID="client-setup-offline" /> : null}
      {p.clientTrigger ? (
        <>
          <FieldLabel>When</FieldLabel>
          <SegRow<ClientTrigger>
            label="When"
            options={[
              { value: "once", label: "Once" },
              { value: "weekly", label: "Weekly" },
              { value: "daily", label: "Daily" },
            ]}
            value={p.clientTrigger}
            onChange={p.onClientTrigger}
            testID="client-setup-when"
          />
        </>
      ) : null}
      <RuleFieldsPresenter
        trigger={p.trigger}
        rule={p.rule}
        onChange={p.onRule}
        testID="client-setup-rule"
      />
    </BottomSheet>
  );
}

/** "+ Add" on C3.3b "Sent to": pick a form from the library to send. */
export function FormPickerSheetPresenter(p: {
  visible: boolean;
  onClose: () => void;
  firstName: string;
  forms: { id: string; title: string; subtitle: string }[];
  onPick: (formId: string) => void;
  onNewForm: () => void;
}) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={`Send a form to ${p.firstName}`}
      accent="trainer"
      testID="form-picker-sheet"
    >
      {p.forms.length === 0 ? (
        <Text
          fontFamily="$body"
          fontSize={13}
          color="$text3"
          testID="form-picker-empty"
        >
          Your library has no forms yet.
        </Text>
      ) : (
        p.forms.map((f) => (
          <ListRow
            key={f.id}
            title={f.title}
            subtitle={f.subtitle}
            onPress={() => p.onPick(f.id)}
            testID={`form-picker-${f.id}`}
          />
        ))
      )}
      <View marginTop={12}>
        <Btn
          variant="outline"
          tone="trainer"
          full
          onPress={p.onNewForm}
          testID="form-picker-new"
        >
          New form
        </Btn>
      </View>
    </BottomSheet>
  );
}
