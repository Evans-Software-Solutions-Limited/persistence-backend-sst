import { useState } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import { BottomSheet, Btn } from "@/ui/components/foundation";
import { IconCheck, IconChevronD } from "@/ui/components/icons";
import {
  FORM_TRIGGERS,
  type FormAudience,
  type FormTrigger,
  type RuleFields,
} from "@/domain/models/coachForms";
import { TRIGGER_LABELS, plural } from "@/domain/services/coachForms.service";
import {
  EditedElsewhere,
  FieldButton,
  FieldLabel,
  OfflineNote,
  SegRow,
} from "./kit";
import { RuleFieldsPresenter } from "./RuleFieldsPresenter";

/**
 * C10h — Send a form: Who (select clients / all clients), When (join · once ·
 * weekly · daily · coaching ends), day, time, due, reminders, then
 * "Send to N clients". Editing a live rule shows the same fields with Save.
 */
export type SendClient = { id: string; name: string; initials: string };

export type SendFormSheetPresenterProps = {
  visible: boolean;
  onClose: () => void;
  formTitle: string;
  editing: boolean;
  audience: FormAudience;
  onAudience: (audience: FormAudience) => void;
  clients: SendClient[];
  selectedIds: string[];
  onToggleClient: (id: string) => void;
  trigger: FormTrigger;
  onTrigger: (trigger: FormTrigger) => void;
  rule: RuleFields;
  onRule: (rule: RuleFields) => void;
  /** Clients it goes to: the chosen ones, or every active client. */
  sendCount: number;
  canSend: boolean;
  onSend: () => void;
  offline: boolean;
  conflict: boolean;
  onDismissConflict: () => void;
};

const AVATAR_TINTS = [
  { bg: "rgba(167,139,250,0.16)", fg: "#C4B5FD" },
  { bg: "rgba(96,165,250,0.16)", fg: "#93C5FD" },
  { bg: "rgba(52,211,153,0.14)", fg: "#6EE7B7" },
  { bg: "rgba(244,114,182,0.14)", fg: "#F9A8D4" },
  { bg: "rgba(250,204,21,0.12)", fg: "#FDE047" },
];

function MiniAvatar(p: { initials: string; index: number; size?: number }) {
  const t = AVATAR_TINTS[p.index % AVATAR_TINTS.length]!;
  const size = p.size ?? 28;
  return (
    <View
      width={size}
      height={size}
      borderRadius={9999}
      backgroundColor={t.bg}
      alignItems="center"
      justifyContent="center"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Text
        fontFamily="$body"
        fontWeight="700"
        fontSize={size > 30 ? 12 : 9}
        color={t.fg}
      >
        {p.initials}
      </Text>
    </View>
  );
}

export function SendFormSheetPresenter(p: SendFormSheetPresenterProps) {
  const [picking, setPicking] = useState(false);
  const [choosingWhen, setChoosingWhen] = useState(false);
  const chosen = p.clients.filter((c) => p.selectedIds.includes(c.id));
  const button = p.editing
    ? "Save"
    : `Send to ${plural(p.sendCount, "client")}`;

  return (
    <BottomSheet
      visible={p.visible}
      onClose={p.onClose}
      title={`Send ${p.formTitle}`}
      accent="trainer"
      height="tall"
      testID="send-form-sheet"
      footer={
        <View paddingHorizontal={20} paddingTop={6}>
          <Btn
            variant="filled"
            tone="trainer"
            size="lg"
            full
            disabled={!p.canSend}
            onPress={p.onSend}
            testID="send-form-submit"
          >
            {button}
          </Btn>
        </View>
      }
    >
      {p.conflict ? (
        <EditedElsewhere
          onDismiss={p.onDismissConflict}
          testID="send-form-conflict"
        />
      ) : null}
      {p.offline ? <OfflineNote testID="send-form-offline" /> : null}

      <FieldLabel>Who</FieldLabel>
      <SegRow
        label="Who"
        options={[
          {
            value: "selected",
            label: "Select clients",
            disabled: p.trigger === "on_join",
          },
          { value: "all_clients", label: "All clients" },
        ]}
        value={p.audience}
        onChange={p.onAudience}
        testID="send-form-who"
      />
      {p.trigger === "on_join" ? (
        <Text
          fontFamily="$body"
          fontSize={12.5}
          color="$text3"
          marginTop={6}
          testID="send-form-join-hint"
        >
          Forms for when they join go to every new client.
        </Text>
      ) : null}
      {p.audience === "selected" ? (
        <View marginTop={8}>
          <FieldButton
            onPress={() => setPicking((v) => !v)}
            accessibilityLabel={`Choose clients: ${chosen.length} chosen`}
            trailing={<IconChevronD size={16} color="#8A8A98" />}
            testID="send-form-choose"
          >
            {chosen.length > 0 ? (
              <View flexDirection="row">
                {chosen.slice(0, 5).map((c, i) => (
                  <View key={c.id} marginLeft={i === 0 ? 0 : -8}>
                    <MiniAvatar initials={c.initials} index={i} />
                  </View>
                ))}
              </View>
            ) : null}
            <Text
              fontFamily="$body"
              fontWeight="500"
              fontSize={14}
              color="$text"
            >
              {chosen.length > 0
                ? plural(chosen.length, "client")
                : "Choose clients"}
            </Text>
          </FieldButton>
          {picking ? (
            <View marginTop={6} testID="send-form-client-list">
              {p.clients.length === 0 ? (
                <Text
                  fontFamily="$body"
                  fontSize={12.5}
                  color="$text3"
                  paddingVertical={10}
                >
                  No active clients yet.
                </Text>
              ) : (
                p.clients.map((c, i) => {
                  const on = p.selectedIds.includes(c.id);
                  return (
                    <Pressable
                      key={c.id}
                      onPress={() => p.onToggleClient(c.id)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={c.name}
                      testID={`send-form-client-${c.id}`}
                    >
                      <View
                        flexDirection="row"
                        alignItems="center"
                        gap={12}
                        paddingVertical={8}
                        borderBottomWidth={1}
                        borderBottomColor="$border"
                      >
                        <MiniAvatar initials={c.initials} index={i} size={32} />
                        <Text
                          flex={1}
                          fontFamily="$body"
                          fontWeight="500"
                          fontSize={14.5}
                          color="$text"
                        >
                          {c.name}
                        </Text>
                        <View
                          width={24}
                          height={24}
                          borderRadius={7}
                          alignItems="center"
                          justifyContent="center"
                          backgroundColor={
                            on ? "$accentTrainer" : "transparent"
                          }
                          borderWidth={on ? 0 : 1.5}
                          borderColor="$border3"
                        >
                          {on ? <IconCheck size={14} color="#1E1B4B" /> : null}
                        </View>
                      </View>
                    </Pressable>
                  );
                })
              )}
            </View>
          ) : null}
        </View>
      ) : null}

      <FieldLabel>When</FieldLabel>
      <FieldButton
        onPress={() => setChoosingWhen((v) => !v)}
        accessibilityLabel={`When: ${TRIGGER_LABELS[p.trigger]}`}
        trailing={<IconChevronD size={16} color="#8A8A98" />}
        testID="send-form-when"
      >
        {TRIGGER_LABELS[p.trigger]}
      </FieldButton>
      {choosingWhen ? (
        <View marginTop={6} testID="send-form-when-options">
          {FORM_TRIGGERS.map((t) => {
            const on = t === p.trigger;
            return (
              <Pressable
                key={t}
                onPress={() => {
                  p.onTrigger(t);
                  setChoosingWhen(false);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
                testID={`send-form-when-${t}`}
              >
                <View
                  flexDirection="row"
                  alignItems="center"
                  paddingVertical={11}
                  borderBottomWidth={1}
                  borderBottomColor="$border"
                >
                  <Text
                    flex={1}
                    fontFamily="$body"
                    fontWeight={on ? "600" : "500"}
                    fontSize={14.5}
                    color={on ? "$accentTrainerBright" : "$text"}
                  >
                    {TRIGGER_LABELS[t]}
                  </Text>
                  {on ? <IconCheck size={16} color="#A78BFA" /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      <RuleFieldsPresenter
        trigger={p.trigger}
        rule={p.rule}
        onChange={p.onRule}
        testID="send-form-rule"
      />
    </BottomSheet>
  );
}
