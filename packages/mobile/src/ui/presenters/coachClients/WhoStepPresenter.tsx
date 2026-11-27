import { KeyboardAvoidingView, Platform, ScrollView } from "react-native";
import { View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import type { WhoValues } from "@/ui/forms/clientProfileForms";
import { FieldInput, FieldLabel } from "@/ui/presenters/coachForms/kit";
import {
  ErrorLine,
  PageTitle,
  PrimaryButton,
  Steps,
  TopBar,
  UpdatedElsewhere,
} from "./kit";

/**
 * C11f — Add client · 1 Who. Only the first name is needed; the rest is
 * optional. In the add flow it shows the steps row and "Next: set up"; when
 * an invited client's details are edited (from C11i) it shows their name
 * and "Save".
 */
export type WhoStepPresenterProps = {
  mode: "add" | "edit";
  title: string;
  backLabel: string;
  values: WhoValues;
  errors: Partial<Record<keyof WhoValues, string>>;
  conflict: boolean;
  onChange: (values: WhoValues) => void;
  onNext: () => void;
  onBack: () => void;
  onDismissConflict: () => void;
};

const FIELDS: readonly {
  key: keyof WhoValues;
  label: string;
  placeholder: string;
  multiline?: boolean;
}[] = [
  { key: "first", label: "First name", placeholder: "" },
  { key: "last", label: "Last name", placeholder: "" },
  { key: "contact", label: "Email or mobile", placeholder: "" },
  { key: "goal", label: "Goal, optional", placeholder: "" },
  {
    key: "notes",
    label: "Private notes, optional",
    placeholder: "Add a note only you see",
    multiline: true,
  },
];

export function WhoStepPresenter(p: WhoStepPresenterProps) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View flex={1} paddingTop={insets.top} testID="who-step">
        <TopBar backLabel={p.backLabel} onBack={p.onBack} testID="who" />
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
          keyboardShouldPersistTaps="handled"
        >
          <PageTitle>{p.title}</PageTitle>
          {p.mode === "add" ? (
            <View marginTop={4} marginBottom={2}>
              <Steps states={["current", "todo", "todo"]} />
            </View>
          ) : null}
          {p.conflict ? (
            <UpdatedElsewhere
              onDismiss={p.onDismissConflict}
              testID="who-conflict"
            />
          ) : null}
          {FIELDS.map((f) => (
            <View key={f.key}>
              <FieldLabel>{f.label}</FieldLabel>
              <FieldInput
                value={p.values[f.key]}
                onChangeText={(v) => p.onChange({ ...p.values, [f.key]: v })}
                placeholder={f.placeholder || undefined}
                accessibilityLabel={f.label}
                multiline={f.multiline}
                testID={`who-${f.key}`}
              />
              {p.errors[f.key] ? (
                <ErrorLine testID={`who-${f.key}-error`}>
                  {p.errors[f.key]!}
                </ErrorLine>
              ) : null}
            </View>
          ))}
        </ScrollView>
        <View
          paddingHorizontal={20}
          paddingTop={8}
          paddingBottom={Math.max(insets.bottom, 16) + 8}
        >
          <PrimaryButton
            label={p.mode === "add" ? "Next: set up" : "Save"}
            onPress={p.onNext}
            testID="who-next"
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
