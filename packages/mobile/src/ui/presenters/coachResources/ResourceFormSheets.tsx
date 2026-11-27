import { Text, View } from "@tamagui/core";

import { BottomSheet, Btn } from "@/ui/components/foundation";
import {
  RESOURCE_TITLE_MAX,
  RESOURCE_URL_MAX,
} from "@/domain/services/coachResources.service";
import type {
  LinkResourceValues,
  ResourceNameValues,
} from "@/ui/forms/resourceForms";
import { FieldInput, FieldLabel, Note } from "@/ui/presenters/coachForms/kit";
import { FieldError } from "./resourceKit";

/**
 * The C3.7c "Link" sheet and the name for a picked photo ("Upload"). Pure:
 * the container owns the react-hook-form and passes values, errors and
 * `onChange` (see `shared/form/controlled.ts`).
 */

export function LinkResourceSheetPresenter(p: {
  visible: boolean;
  onClose: () => void;
  values: LinkResourceValues;
  errors: Partial<Record<keyof LinkResourceValues, string>>;
  onChange: (values: LinkResourceValues) => void;
  onSave: () => void;
  busy: boolean;
  offline: boolean;
  error: string | null;
  hint: string;
}) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title="Add a link"
      accent="trainer"
      testID="link-resource-sheet"
      footer={
        <View paddingHorizontal={20} paddingTop={6}>
          <Btn
            variant="filled"
            tone="trainer"
            size="lg"
            full
            disabled={p.busy}
            onPress={p.onSave}
            testID="link-resource-save"
          >
            {p.busy ? "Adding…" : "Add link"}
          </Btn>
        </View>
      }
    >
      {p.offline ? (
        <Note testID="link-resource-offline">
          You're offline. The link is saved on this phone and sends when you're
          back.
        </Note>
      ) : null}
      {p.error ? <Note testID="link-resource-error">{p.error}</Note> : null}
      <FieldLabel>Name</FieldLabel>
      <FieldInput
        value={p.values.title}
        onChangeText={(title) => p.onChange({ ...p.values, title })}
        accessibilityLabel="Name"
        maxLength={RESOURCE_TITLE_MAX}
        testID="link-resource-title"
      />
      <FieldError message={p.errors.title} testID="link-resource-title-error" />
      <FieldLabel>Link</FieldLabel>
      <FieldInput
        value={p.values.url}
        onChangeText={(url) => p.onChange({ ...p.values, url })}
        placeholder="https://"
        accessibilityLabel="Link"
        maxLength={RESOURCE_URL_MAX}
        testID="link-resource-url"
      />
      <FieldError message={p.errors.url} testID="link-resource-url-error" />
      <Text marginTop={12} fontFamily="$body" fontSize={12} color="$text3">
        {p.hint}
      </Text>
    </BottomSheet>
  );
}

export function NameResourceSheetPresenter(p: {
  visible: boolean;
  onClose: () => void;
  values: ResourceNameValues;
  errors: Partial<Record<keyof ResourceNameValues, string>>;
  onChange: (values: ResourceNameValues) => void;
  onSave: () => void;
  busy: boolean;
  error: string | null;
  hint: string;
}) {
  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title="Name this photo"
      accent="trainer"
      testID="name-resource-sheet"
      footer={
        <View paddingHorizontal={20} paddingTop={6}>
          <Btn
            variant="filled"
            tone="trainer"
            size="lg"
            full
            disabled={p.busy}
            onPress={p.onSave}
            testID="name-resource-save"
          >
            {p.busy ? "Uploading…" : "Upload"}
          </Btn>
        </View>
      }
    >
      {p.error ? <Note testID="name-resource-error">{p.error}</Note> : null}
      <FieldLabel>Name</FieldLabel>
      <FieldInput
        value={p.values.title}
        onChangeText={(title) => p.onChange({ title })}
        accessibilityLabel="Name"
        maxLength={RESOURCE_TITLE_MAX}
        testID="name-resource-title"
      />
      <FieldError message={p.errors.title} testID="name-resource-title-error" />
      <Text marginTop={12} fontFamily="$body" fontSize={12} color="$text3">
        {p.hint}
      </Text>
    </BottomSheet>
  );
}
