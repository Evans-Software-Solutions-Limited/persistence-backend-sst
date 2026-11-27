import { useState, type ReactNode } from "react";
import { Pressable } from "react-native";
import { Text, View } from "@tamagui/core";

import {
  IconCheck,
  IconChevronD,
  IconChevronR,
  IconEye,
} from "@/ui/components/icons";
import { Btn } from "@/ui/components/foundation";
import type { Question } from "@/domain/models/coachForms";
import { QUESTION_TYPE_LABELS } from "@/domain/services/coachForms.service";
import { BackLink, Note } from "@/ui/presenters/coachForms/kit";

/**
 * PER-125 shared pieces for the iPhone add-client boards (C11f–s, C11i).
 * Values come from the boards' `.ph` header (back label left, action
 * right), steps row, `.row`, `.lk`, `.btn.v` and `.ghost` styles.
 */

export const UPDATED_ELSEWHERE =
  "Updated on another device. You're seeing the latest version.";

/** The 52pt bar above each board: back label left, quiet action right. */
export function TopBar(p: {
  backLabel: string;
  onBack: () => void;
  right?: { label: string; onPress: () => void; testID?: string } | null;
  testID?: string;
}) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingHorizontal={10}
      height={52}
      testID={p.testID}
    >
      <BackLink
        label={p.backLabel}
        onPress={p.onBack}
        testID={p.testID ? `${p.testID}-back` : undefined}
      />
      {p.right ? (
        <Pressable
          onPress={p.right.onPress}
          accessibilityRole="button"
          testID={p.right.testID}
          style={{
            minHeight: 44,
            justifyContent: "center",
            paddingHorizontal: 8,
          }}
        >
          <Text
            fontFamily="$body"
            fontWeight="500"
            fontSize={14}
            color="$text2"
          >
            {p.right.label}
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

export function PageTitle(p: { children: string; size?: 26 | 28 }) {
  const size = p.size ?? 28;
  return (
    <Text
      fontFamily="$display"
      fontWeight="800"
      fontSize={size}
      lineHeight={size + 6}
      letterSpacing={size === 28 ? -0.7 : -0.6}
      color="$text"
      accessibilityRole="header"
    >
      {p.children}
    </Text>
  );
}

/** A section page's grey line under the title. */
export function PageSub(p: { children: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize={13}
      lineHeight={18}
      color="$text3"
      marginTop={2}
      marginBottom={10}
    >
      {p.children}
    </Text>
  );
}

export type StepState = "done" | "current" | "todo";

/** 1 Who · 2 Set up · 3 Invite. `compact` is the set-up board's smaller row. */
export function Steps(p: {
  states: readonly [StepState, StepState, StepState];
  compact?: boolean;
}) {
  const size = p.compact ? 24 : 28;
  const labels = ["Who", "Set up", "Invite"];
  return (
    <View
      flexDirection="row"
      gap={p.compact ? 10 : 14}
      accessibilityLabel="Steps"
      testID="add-client-steps"
    >
      {labels.map((label, i) => {
        const state = p.states[i]!;
        return (
          <View
            key={label}
            flexDirection="row"
            alignItems="center"
            gap={8}
            accessibilityState={{ selected: state === "current" }}
          >
            <View
              width={size}
              height={size}
              borderRadius={9999}
              alignItems="center"
              justifyContent="center"
              backgroundColor={
                state === "current"
                  ? "$accentTrainer"
                  : state === "done"
                    ? "rgba(167,139,250,0.18)"
                    : "transparent"
              }
              borderWidth={state === "todo" ? 1.5 : 0}
              borderColor="$text4"
            >
              {state === "done" ? (
                <IconCheck size={14} color="#C4B5FD" />
              ) : (
                <Text
                  fontFamily="$mono"
                  fontWeight="700"
                  fontSize={12.5}
                  color={state === "current" ? "$accentTrainerInk" : "$text3"}
                >
                  {i + 1}
                </Text>
              )}
            </View>
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={p.compact ? 12.5 : 13.5}
              color={state === "current" ? "$text" : "$text3"}
            >
              {label}
            </Text>
          </View>
        );
      })}
    </View>
  );
}

/** The green tick / dashed circle at the start of a checklist row. */
function AddedMark(p: { added: boolean }) {
  return p.added ? (
    <View
      width={24}
      height={24}
      borderRadius={9999}
      backgroundColor="rgba(52,211,153,0.14)"
      alignItems="center"
      justifyContent="center"
      accessibilityLabel="Added"
    >
      <IconCheck size={14} color="#34D399" />
    </View>
  ) : (
    <View
      width={24}
      height={24}
      borderRadius={9999}
      borderWidth={1.5}
      borderStyle="dashed"
      borderColor="$text4"
      accessibilityLabel="Not added"
    />
  );
}

/** C11g row: added mark, title, summary, "+ Add" when empty, chevron. */
export function ChecklistRow(p: {
  title: string;
  summary: string;
  added: boolean;
  onPress: () => void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="button"
      accessibilityLabel={`Open ${p.title}`}
      testID={p.testID}
    >
      <View
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingVertical={9}
        borderBottomWidth={1}
        borderBottomColor="$border"
      >
        <AddedMark added={p.added} />
        <View flex={1} minWidth={0} gap={2}>
          <Text
            fontFamily="$body"
            fontWeight="500"
            fontSize={14.5}
            lineHeight={20}
            color="$text"
          >
            {p.title}
          </Text>
          <Text
            fontFamily="$body"
            fontSize={12}
            lineHeight={16}
            color="$text3"
            numberOfLines={1}
          >
            {p.summary}
          </Text>
        </View>
        {!p.added ? (
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={13}
            color="$accentTrainer"
          >
            + Add
          </Text>
        ) : null}
        <IconChevronR size={16} color="#5C5C68" />
      </View>
    </Pressable>
  );
}

/** A quiet bordered button (`.btn.sm.ghost`), e.g. Preview. */
export function GhostButton(p: {
  label: string;
  onPress: () => void;
  icon?: "eye";
  height?: number;
  full?: boolean;
  disabled?: boolean;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      disabled={p.disabled}
      accessibilityRole="button"
      accessibilityLabel={p.accessibilityLabel ?? p.label}
      accessibilityState={{ disabled: !!p.disabled }}
      testID={p.testID}
      style={p.full ? { flex: 1 } : undefined}
    >
      <View
        height={p.height ?? 40}
        paddingHorizontal={12}
        borderRadius={14}
        borderWidth={1}
        borderColor="$border3"
        flexDirection="row"
        alignItems="center"
        justifyContent="center"
        gap={6}
        opacity={p.disabled ? 0.5 : 1}
      >
        {p.icon === "eye" ? <IconEye size={16} color="#F4F4F8" /> : null}
        <Text fontFamily="$body" fontWeight="600" fontSize={13} color="$text">
          {p.label}
        </Text>
      </View>
    </Pressable>
  );
}

/** The violet primary button pinned at the bottom of a board. */
export function PrimaryButton(p: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  icon?: ReactNode;
  testID?: string;
}) {
  return (
    <Btn
      variant="filled"
      tone="trainer"
      size="lg"
      full
      icon={p.icon}
      onPress={p.onPress}
      disabled={p.disabled}
      testID={p.testID}
    >
      {p.label}
    </Btn>
  );
}

/** "Back saves. Cancel drops changes." under every section page. */
export function SavesHint() {
  return (
    <Text
      textAlign="center"
      fontFamily="$body"
      fontSize={12}
      color="$text3"
      testID="saves-hint"
    >
      Back saves. Cancel drops changes.
    </Text>
  );
}

export function UpdatedElsewhere(p: {
  onDismiss: () => void;
  testID?: string;
}) {
  return (
    <Note onDismiss={p.onDismiss} testID={p.testID ?? "updated-elsewhere"}>
      {UPDATED_ELSEWHERE}
    </Note>
  );
}

export function ErrorLine(p: { children: string; testID?: string }) {
  return (
    <Text
      fontFamily="$body"
      fontSize={12.5}
      lineHeight={17}
      color="#FCA5A5"
      marginTop={6}
      accessibilityRole="alert"
      testID={p.testID}
    >
      {p.children}
    </Text>
  );
}

/** "Show questions" / "Hide questions": the first five, then "+N more". */
export function QuestionsToggle(p: {
  questions: readonly Question[];
  testID?: string;
}) {
  const [open, setOpen] = useState(false);
  if (p.questions.length === 0) return null;
  const shown = p.questions.slice(0, 5);
  return (
    <View paddingLeft={26}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={p.testID}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <View flexDirection="row" alignItems="center" gap={4}>
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={13}
            color="$text2"
          >
            {open ? "Hide questions" : "Show questions"}
          </Text>
          <View style={{ transform: [{ rotate: open ? "180deg" : "0deg" }] }}>
            <IconChevronD size={14} color="#C2C2CE" />
          </View>
        </View>
      </Pressable>
      {open ? (
        <>
          {shown.map((q, i) => (
            <View
              key={q.id}
              flexDirection="row"
              gap={10}
              paddingVertical={7}
              borderBottomWidth={1}
              borderBottomColor="$border"
            >
              <Text width={18} fontFamily="$mono" fontSize={13} color="$text3">
                {i + 1}
              </Text>
              <Text flex={1} fontFamily="$body" fontSize={13} color="$text">
                {q.prompt}
              </Text>
              <Text fontFamily="$body" fontSize={13} color="$text3">
                {q.prefill ? "Filled for them" : QUESTION_TYPE_LABELS[q.type]}
              </Text>
            </View>
          ))}
          {p.questions.length > shown.length ? (
            <Text
              fontFamily="$body"
              fontSize={12.5}
              color="$text3"
              marginTop={6}
            >
              +{p.questions.length - shown.length} more questions
            </Text>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

/** "Add a form from your Library": opens the list of what can be added. */
export function LibraryPicker(p: {
  label: string;
  empty: string;
  loading?: boolean;
  offline?: boolean;
  rows: readonly {
    id: string;
    title: string;
    sub: string;
  }[];
  onAdd: (id: string) => void;
  testID: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <View marginTop={4}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        testID={p.testID}
        style={{ minHeight: 44, justifyContent: "center" }}
      >
        <Text
          fontFamily="$body"
          fontWeight="600"
          fontSize={13}
          color="$accentTrainer"
        >
          {p.label}
        </Text>
      </Pressable>
      {open ? (
        p.rows.length === 0 ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            color="$text3"
            testID={`${p.testID}-empty`}
          >
            {p.loading
              ? "Loading your Library…"
              : p.offline
                ? "Your Library needs a connection. Try again when you're back online."
                : p.empty}
          </Text>
        ) : (
          p.rows.map((r) => (
            <View
              key={r.id}
              flexDirection="row"
              alignItems="center"
              gap={12}
              paddingVertical={12}
              borderBottomWidth={1}
              borderBottomColor="$border"
            >
              <View flex={1} minWidth={0} gap={2}>
                <Text
                  fontFamily="$body"
                  fontWeight="500"
                  fontSize={15}
                  color="$text"
                >
                  {r.title}
                </Text>
                {r.sub ? (
                  <Text fontFamily="$body" fontSize={12} color="$text3">
                    {r.sub}
                  </Text>
                ) : null}
              </View>
              <Btn
                variant="soft"
                tone="trainer"
                size="sm"
                onPress={() => p.onAdd(r.id)}
                accessibilityLabel={`Add ${r.title}`}
                testID={`${p.testID}-add-${r.id}`}
              >
                Add
              </Btn>
            </View>
          ))
        )
      ) : null}
    </View>
  );
}
