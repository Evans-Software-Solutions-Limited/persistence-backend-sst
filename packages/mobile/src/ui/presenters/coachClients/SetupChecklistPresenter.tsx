import { useState } from "react";
import { Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn } from "@/ui/components/foundation";
import { IconLayers } from "@/ui/components/icons";
import type { SetupSection } from "@/domain/models/coachClientProfiles";
import {
  ChecklistRow,
  ErrorLine,
  GhostButton,
  PageTitle,
  PrimaryButton,
  Steps,
  TopBar,
  UpdatedElsewhere,
} from "./kit";

/**
 * C11g — Set up (checklist). Each row opens its own page (C11l–r); Preview
 * sits by the steps (C11s); Copy from a client fills sections from one of
 * the coach's active clients (online only). Back goes to Who, Skip and Next
 * go to the invite.
 */
export type ChecklistRowView = {
  section: SetupSection;
  title: string;
  summary: string;
  added: boolean;
};

export type CopySource = { id: string; name: string };

export type SetupChecklistPresenterProps = {
  clientFirst: string;
  /** Add flow: the steps row, Skip and "Next: invite". Edit (C11i): neither. */
  mode: "add" | "edit";
  rows: readonly ChecklistRowView[];
  done: number;
  total: number;
  conflict: boolean;
  copySources: readonly CopySource[];
  copyBusy: boolean;
  copyError: string | null;
  onOpen: (section: SetupSection) => void;
  onPreview: () => void;
  onCopyFrom: (clientId: string) => void;
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  onDismissConflict: () => void;
};

export function SetupChecklistPresenter(p: SetupChecklistPresenterProps) {
  const insets = useSafeAreaInsets();
  const [copyOpen, setCopyOpen] = useState(false);
  return (
    <View flex={1} paddingTop={insets.top} testID="setup-checklist">
      <TopBar
        backLabel={p.mode === "add" ? "Back" : "Clients"}
        onBack={p.onBack}
        right={
          p.mode === "add"
            ? { label: "Skip", onPress: p.onSkip, testID: "setup-skip" }
            : null
        }
        testID="setup"
      />
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
      >
        <PageTitle>{`Set up ${p.clientFirst}`}</PageTitle>
        <View
          flexDirection="row"
          alignItems="center"
          gap={8}
          marginTop={6}
          marginBottom={12}
        >
          {p.mode === "add" ? (
            <Steps states={["done", "current", "todo"]} compact />
          ) : null}
          <View flex={1} />
          <GhostButton
            label="Preview"
            icon="eye"
            onPress={p.onPreview}
            accessibilityLabel={`Preview as ${p.clientFirst}`}
            testID="setup-preview"
          />
        </View>
        {p.conflict ? (
          <UpdatedElsewhere
            onDismiss={p.onDismissConflict}
            testID="setup-conflict"
          />
        ) : null}
        <View flexDirection="row" alignItems="center" gap={8}>
          <Text
            flex={1}
            fontFamily="$body"
            fontWeight="600"
            fontSize={13}
            color="$text2"
            testID="setup-count"
          >
            {`${p.done} of ${p.total} set up`}
          </Text>
          <Pressable
            onPress={() => setCopyOpen(!copyOpen)}
            accessibilityRole="button"
            accessibilityState={{ expanded: copyOpen }}
            testID="setup-copy"
            style={{ minHeight: 36, justifyContent: "center" }}
          >
            <View flexDirection="row" alignItems="center" gap={4}>
              <IconLayers size={14} color="#A78BFA" />
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={13}
                color="$accentTrainer"
              >
                Copy from a client
              </Text>
            </View>
          </Pressable>
        </View>
        {copyOpen ? (
          <View marginBottom={8} testID="setup-copy-list">
            {p.copySources.length === 0 ? (
              <Text fontFamily="$body" fontSize={12.5} color="$text3">
                No active clients to copy from yet.
              </Text>
            ) : (
              p.copySources.map((c) => (
                <View
                  key={c.id}
                  flexDirection="row"
                  alignItems="center"
                  gap={12}
                  paddingVertical={10}
                  borderBottomWidth={1}
                  borderBottomColor="$border"
                >
                  <Text
                    flex={1}
                    fontFamily="$body"
                    fontWeight="500"
                    fontSize={15}
                    color="$text"
                  >
                    {c.name}
                  </Text>
                  <Btn
                    variant="soft"
                    tone="trainer"
                    size="sm"
                    disabled={p.copyBusy}
                    onPress={() => p.onCopyFrom(c.id)}
                    accessibilityLabel={`Copy set-up from ${c.name}`}
                    testID={`setup-copy-${c.id}`}
                  >
                    Copy
                  </Btn>
                </View>
              ))
            )}
            {p.copyError ? (
              <ErrorLine testID="setup-copy-error">{p.copyError}</ErrorLine>
            ) : null}
          </View>
        ) : null}
        {p.rows.map((r) => (
          <ChecklistRow
            key={r.section}
            title={r.title}
            summary={r.summary}
            added={r.added}
            onPress={() => p.onOpen(r.section)}
            testID={`setup-row-${r.section}`}
          />
        ))}
      </ScrollView>
      {p.mode === "add" ? (
        <View
          paddingHorizontal={20}
          paddingTop={8}
          paddingBottom={Math.max(insets.bottom, 16) + 8}
        >
          <PrimaryButton
            label="Next: invite"
            onPress={p.onNext}
            testID="setup-next"
          />
        </View>
      ) : null}
    </View>
  );
}
