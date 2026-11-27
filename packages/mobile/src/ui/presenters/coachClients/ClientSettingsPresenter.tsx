import { useState } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import { IconMinus, IconPlus } from "@/ui/components/icons";
import type {
  AlertMode,
  FeatureKey,
} from "@/domain/models/coachClientProfiles";
import type { SettingsFormValues } from "@/ui/forms/clientProfileForms";
import { ListRow, SegRow, ToggleRow } from "@/ui/presenters/coachForms/kit";
import { Eyebrow } from "@/ui/presenters/coaching/coachingKit";
import { ErrorLine, UpdatedElsewhere } from "./kit";

/**
 * C3.9 (iPhone) — client settings: what this client gets (feature
 * switches), what the coach tracks (design B: training sessions against a
 * weekly target, calories), alerts, and End coaching. One column, as the
 * board. Every change saves on its own (offline too).
 */
export const FEATURES: readonly {
  key: FeatureKey;
  title: string;
  sub: string;
}[] = [
  { key: "messages", title: "Messages", sub: "Chat with you" },
  { key: "checkIns", title: "Check-ins", sub: "Weekly and daily forms" },
  { key: "photos", title: "Progress photos", sub: "Front, side and back" },
  { key: "habits", title: "Habits", sub: "Steps, water, sleep, custom" },
  { key: "nutrition", title: "Nutrition", sub: "Meal plans and food logging" },
  { key: "resources", title: "Resources", sub: "Files and videos you share" },
];

export const ALERT_OPTIONS: readonly { value: AlertMode; label: string }[] = [
  { value: "default", label: "Use my defaults" },
  { value: "mute", label: "Mute all" },
  { value: "everything", label: "Boost: every event" },
];

const ALERT_SHORT: Record<AlertMode, string> = {
  default: "Your defaults",
  mute: "Muted",
  everything: "Every event",
};

export type ClientSettingsPresenterProps = {
  clientFirst: string;
  values: SettingsFormValues | null;
  error: string | null;
  conflict: boolean;
  loadFailed: boolean;
  ending: boolean;
  onTraining: (on: boolean) => void;
  onCalories: (on: boolean) => void;
  onSessions: (n: number) => void;
  onFeature: (key: FeatureKey, on: boolean) => void;
  onAlertMode: (mode: AlertMode) => void;
  onEndCoaching: () => void;
  onDismissConflict: () => void;
};

function Section(p: {
  title: string;
  children: React.ReactNode;
  testID: string;
}) {
  return (
    <View marginTop={18} testID={p.testID}>
      <Eyebrow>{p.title}</Eyebrow>
      <View marginTop={4}>{p.children}</View>
    </View>
  );
}

function StepButton(p: {
  label: string;
  onPress: () => void;
  disabled: boolean;
  kind: "minus" | "plus";
  testID: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityLabel={p.label}
      accessibilityState={{ disabled: p.disabled }}
      testID={p.testID}
    >
      <View
        width={44}
        height={44}
        borderRadius={9999}
        borderWidth={1}
        borderColor="$border2"
        backgroundColor="$surface"
        alignItems="center"
        justifyContent="center"
        opacity={p.disabled ? 0.4 : 1}
      >
        {p.kind === "minus" ? (
          <IconMinus size={16} color="#F4F4F8" />
        ) : (
          <IconPlus size={16} color="#F4F4F8" />
        )}
      </View>
    </Pressable>
  );
}

export function ClientSettingsPresenter(p: ClientSettingsPresenterProps) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  if (!p.values) {
    return (
      <View
        paddingHorizontal={20}
        paddingTop={16}
        testID="client-settings-empty"
      >
        <Text fontFamily="$body" fontSize={13} color="$text3">
          {p.loadFailed
            ? "Couldn't load the settings. Pull down to try again."
            : "Loading settings…"}
        </Text>
      </View>
    );
  }
  const v = p.values;
  const sessions = v.sessionsPerWeek ?? 3;
  return (
    <View paddingHorizontal={20} testID="client-settings">
      {p.conflict ? (
        <UpdatedElsewhere
          onDismiss={p.onDismissConflict}
          testID="settings-conflict"
        />
      ) : null}
      <Section title={`Tracked for ${p.clientFirst}`} testID="settings-tracked">
        <ToggleRow
          label="Training"
          detail="Sessions done vs your weekly target"
          value={v.trackTraining}
          onChange={p.onTraining}
          testID="settings-training"
        />
        {v.trackTraining ? (
          <View
            flexDirection="row"
            alignItems="center"
            gap={12}
            paddingVertical={6}
            testID="settings-sessions"
          >
            <Text flex={1} fontFamily="$body" fontSize={13} color="$text2">
              Sessions a week
            </Text>
            <StepButton
              label="Fewer sessions"
              kind="minus"
              disabled={sessions <= 1}
              onPress={() => p.onSessions(sessions - 1)}
              testID="settings-sessions-minus"
            />
            <Text
              width={28}
              textAlign="center"
              fontFamily="$mono"
              fontWeight="700"
              fontSize={17}
              color="$text"
              testID="settings-sessions-value"
            >
              {sessions}
            </Text>
            <StepButton
              label="More sessions"
              kind="plus"
              disabled={sessions >= 14}
              onPress={() => p.onSessions(sessions + 1)}
              testID="settings-sessions-plus"
            />
          </View>
        ) : null}
        <ToggleRow
          label="Calories"
          detail="Days within 10% of the target"
          value={v.trackCalories}
          onChange={p.onCalories}
          testID="settings-calories"
        />
        {p.error ? (
          <ErrorLine testID="settings-error">{p.error}</ErrorLine>
        ) : null}
      </Section>
      <Section
        title={`Features for ${p.clientFirst}`}
        testID="settings-features"
      >
        {FEATURES.map((f) => (
          <ToggleRow
            key={f.key}
            label={f.title}
            detail={f.sub}
            value={v.features[f.key]}
            onChange={(on) => p.onFeature(f.key, on)}
            testID={`settings-feature-${f.key}`}
          />
        ))}
        <Text fontFamily="$body" fontSize={12} color="$text3" marginTop={4}>
          {`Off hides it from ${p.clientFirst}'s app.`}
        </Text>
      </Section>
      <View marginTop={12}>
        <ListRow
          title={`Alerts for ${p.clientFirst}`}
          subtitle={ALERT_SHORT[v.alertMode]}
          onPress={() => setAlertsOpen(!alertsOpen)}
          testID="settings-alerts"
        />
        {alertsOpen ? (
          <View marginTop={10}>
            <SegRow
              label={`Alerts for ${p.clientFirst}`}
              value={v.alertMode}
              onChange={p.onAlertMode}
              options={ALERT_OPTIONS}
              testID="settings-alert-mode"
            />
          </View>
        ) : null}
      </View>
      <Pressable
        onPress={p.onEndCoaching}
        disabled={p.ending}
        accessibilityRole="button"
        testID="settings-end"
        style={{ minHeight: 44, justifyContent: "center", marginTop: 12 }}
      >
        <Text fontFamily="$body" fontWeight="600" fontSize={14} color="#FCA5A5">
          {p.ending ? "Ending…" : `End coaching with ${p.clientFirst}`}
        </Text>
      </Pressable>
    </View>
  );
}
