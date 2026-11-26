import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation/Btn";
import { BackLink, Note } from "@/ui/presenters/coachForms/kit";
import {
  NO_LONGER_NEEDED,
  type AnswerValue,
} from "@/domain/models/athleteForms";
import type { Question } from "@/domain/models/coachForms";
import { QuestionInput } from "./QuestionInput";

/**
 * PER-130 — canvas C4f: filling in a form from the Coach tab, one question
 * per screen. "‹ Coach" and "Saved" on top, a progress bar, "Weekly
 * check-in · 7 of 12", the question, its answer, then Back / Next (Send on
 * the last one). Also the 409 state: "This check-in is no longer needed".
 */

export type FormFillPresenterProps = {
  state: "loading" | "form" | "closed" | "missing";
  formTitle: string;
  step: number;
  total: number;
  question: Question | null;
  value: AnswerValue;
  error: string | null;
  /** "Saved" once the draft is on the phone. */
  saved: boolean;
  isLast: boolean;
  nextDisabled: boolean;
  busy: boolean;
  banner: string | null;
  onChange(value: AnswerValue): void;
  onAddPhoto(): void;
  onBack(): void;
  onNext(): void;
  onClose(): void;
};

function TopBar(p: { saved: boolean; onClose(): void }) {
  return (
    <View
      flexDirection="row"
      alignItems="center"
      justifyContent="space-between"
      paddingHorizontal={10}
      height={52}
    >
      <BackLink label="Coach" onPress={p.onClose} testID="form-fill-close" />
      {p.saved ? (
        <Text
          fontFamily="$body"
          fontWeight="500"
          fontSize={12}
          color="$text3"
          paddingRight={10}
          testID="form-fill-saved"
        >
          Saved
        </Text>
      ) : null}
    </View>
  );
}

function Message(p: { title: string; onClose(): void; testID: string }) {
  return (
    <View
      flex={1}
      paddingHorizontal={20}
      paddingTop={24}
      gap={18}
      testID={p.testID}
    >
      <Text
        fontFamily="$display"
        fontWeight="800"
        fontSize={26}
        lineHeight={32}
        letterSpacing={-0.6}
        color="$text"
        accessibilityRole="header"
      >
        {p.title}
      </Text>
      <Btn variant="filled" tone="trainer" size="lg" full onPress={p.onClose}>
        Back to Coach
      </Btn>
    </View>
  );
}

export function FormFillPresenter(p: FormFillPresenterProps) {
  const insets = useSafeAreaInsets();
  const progress = p.total > 0 ? (p.step + 1) / p.total : 0;

  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <TopBar saved={p.state === "form" && p.saved} onClose={p.onClose} />
      {p.state === "loading" ? (
        <View flex={1} testID="form-fill-loading" />
      ) : p.state === "closed" ? (
        <Message
          title={NO_LONGER_NEEDED}
          onClose={p.onClose}
          testID="form-fill-closed"
        />
      ) : p.state === "missing" || !p.question ? (
        <Message
          title={NO_LONGER_NEEDED}
          onClose={p.onClose}
          testID="form-fill-missing"
        />
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 24 }}
            keyboardShouldPersistTaps="handled"
            testID="form-fill"
          >
            <View
              height={4}
              borderRadius={9999}
              backgroundColor="$surface3"
              marginBottom={18}
              accessibilityRole="progressbar"
              accessibilityValue={{ min: 0, max: p.total, now: p.step + 1 }}
            >
              <View
                height={4}
                borderRadius={9999}
                backgroundColor="$accentTrainer"
                width={`${Math.round(progress * 100)}%`}
                testID="form-fill-progress"
              />
            </View>
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={11}
              lineHeight={14}
              letterSpacing={2.6}
              textTransform="uppercase"
              color="$accentTrainer"
              testID="form-fill-eyebrow"
            >
              {`${p.formTitle} · ${p.step + 1} of ${p.total}`}
            </Text>
            <Text
              fontFamily="$display"
              fontWeight="800"
              fontSize={26}
              lineHeight={32}
              letterSpacing={-0.6}
              color="$text"
              marginTop={8}
              marginBottom={4}
              accessibilityRole="header"
            >
              {p.question.prompt}
            </Text>
            {p.question.help ? (
              <Text
                fontFamily="$body"
                fontSize={13.5}
                lineHeight={19}
                color="$text2"
              >
                {p.question.help}
              </Text>
            ) : null}
            <View marginTop={18}>
              <QuestionInput
                question={p.question}
                value={p.value}
                onChange={p.onChange}
                onAddPhoto={p.onAddPhoto}
                testID="form-fill-answer"
              />
            </View>
            {p.error ? (
              <Text
                fontFamily="$body"
                fontSize={12.5}
                lineHeight={17}
                color="$error"
                marginTop={8}
                accessibilityRole="alert"
                testID="form-fill-error"
              >
                {p.error}
              </Text>
            ) : null}
            {p.banner ? (
              <Note testID="form-fill-banner">{p.banner}</Note>
            ) : null}
          </ScrollView>
          <View
            flexDirection="row"
            gap={8}
            paddingHorizontal={20}
            paddingTop={8}
            paddingBottom={Math.max(insets.bottom, 12) + 22}
          >
            <Pressable
              onPress={p.onBack}
              disabled={p.busy}
              accessibilityRole="button"
              accessibilityState={{ disabled: p.busy }}
              style={{ flex: 4 }}
              testID="form-fill-back"
            >
              <View
                height={52}
                borderRadius={14}
                borderWidth={1}
                borderColor="$border3"
                alignItems="center"
                justifyContent="center"
                opacity={p.busy ? 0.5 : 1}
              >
                <Text
                  fontFamily="$body"
                  fontWeight="600"
                  fontSize={15}
                  color="$text"
                >
                  Back
                </Text>
              </View>
            </Pressable>
            <View flex={6}>
              <Btn
                variant="filled"
                tone="trainer"
                size="lg"
                full
                onPress={p.onNext}
                disabled={p.nextDisabled || p.busy}
                accessibilityState={{
                  disabled: p.nextDisabled || p.busy,
                  busy: p.busy,
                }}
                testID="form-fill-next"
              >
                {p.isLast ? (p.busy ? "Sending…" : "Send") : "Next"}
              </Btn>
            </View>
          </View>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
