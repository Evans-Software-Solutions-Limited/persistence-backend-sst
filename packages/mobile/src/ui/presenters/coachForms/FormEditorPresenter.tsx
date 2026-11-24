import { Pressable, ScrollView, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Btn } from "@/ui/components/foundation";
import { IconPlus, IconX } from "@/ui/components/icons";
import {
  MAX_OPTIONS,
  MAX_QUESTIONS,
  QUESTION_TYPES,
  type PrefillSource,
  type Question,
  type QuestionType,
} from "@/domain/models/coachForms";
import {
  PREFILL_LABELS,
  QUESTION_TYPE_LABELS,
  prefillSourcesFor,
  questionSubtitle,
} from "@/domain/services/coachForms.service";
import {
  BackLink,
  ChoiceChips,
  EditedElsewhere,
  FieldInput,
  FieldLabel,
  LinkButton,
  OfflineNote,
  StatusPill,
  ToggleRow,
} from "./kit";

/**
 * C10b on iPhone: the same fields as the web editor, one column. The
 * question list; tapping one opens its fields below it (prompt, help, answer
 * type, options / min-max-unit / details if yes, filled for them, required)
 * with move, duplicate and delete. Save sends `expectedRevision`.
 */
export type FormEditorPresenterProps = {
  isNew: boolean;
  title: string;
  onTitle: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  /** "12 questions · version 3" for a saved form. */
  meta: string | null;
  questions: Question[];
  openIndex: number | null;
  onOpen: (index: number | null) => void;
  onChangeQuestion: (index: number, q: Question) => void;
  onRetype: (index: number, type: QuestionType) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onDuplicate: (index: number) => void;
  onDelete: (index: number) => void;
  onAdd: () => void;
  problem: string | null;
  saving: boolean;
  onSave: () => void;
  onBack: () => void;
  offline: boolean;
  conflict: boolean;
  onDismissConflict: () => void;
};

export function FormEditorPresenter(p: FormEditorPresenterProps) {
  const insets = useSafeAreaInsets();
  return (
    <View flex={1} paddingTop={insets.top} testID="form-editor">
      <View
        flexDirection="row"
        alignItems="center"
        justifyContent="space-between"
        paddingHorizontal={10}
        height={52}
      >
        <BackLink label="Forms" onPress={p.onBack} testID="form-editor-back" />
        <Btn
          variant="filled"
          tone="trainer"
          size="sm"
          disabled={p.saving}
          onPress={p.onSave}
          testID="form-editor-save"
        >
          {p.isNew ? "Save form" : "Save changes"}
        </Btn>
      </View>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 160 }}
        keyboardShouldPersistTaps="handled"
      >
        {p.conflict ? (
          <EditedElsewhere
            onDismiss={p.onDismissConflict}
            testID="form-editor-conflict"
          />
        ) : null}
        {p.offline ? <OfflineNote testID="form-editor-offline" /> : null}
        <TextInput
          value={p.title}
          onChangeText={p.onTitle}
          placeholder="Form title"
          placeholderTextColor="#5C5C68"
          accessibilityLabel="Form title"
          maxLength={120}
          testID="form-editor-title"
          style={{
            marginTop: 8,
            color: "#F4F4F8",
            fontFamily: "Geist",
            fontWeight: "800",
            fontSize: 26,
            letterSpacing: -0.6,
          }}
        />
        {p.meta ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$text3"
            testID="form-editor-meta"
          >
            {p.meta}
          </Text>
        ) : null}
        {!p.isNew ? (
          <Text
            fontFamily="$body"
            fontSize={12.5}
            lineHeight={17}
            color="$text3"
            marginTop={8}
          >
            Your changes apply from the next one. Answers already sent keep the
            questions they were asked.
          </Text>
        ) : null}
        <FieldLabel>Description, optional</FieldLabel>
        <FieldInput
          value={p.description}
          onChangeText={p.onDescription}
          placeholder="What it's for"
          accessibilityLabel="Description"
          multiline
          maxLength={1000}
          testID="form-editor-description"
        />

        <View marginTop={18}>
          {p.questions.map((q, i) => (
            <QuestionItem key={q.id} index={i} q={q} p={p} />
          ))}
        </View>
        {p.questions.length < MAX_QUESTIONS ? (
          <Pressable
            onPress={p.onAdd}
            accessibilityRole="button"
            accessibilityLabel="Add question"
            testID="form-editor-add"
          >
            <View
              flexDirection="row"
              alignItems="center"
              gap={8}
              paddingVertical={14}
            >
              <IconPlus size={16} color="#A78BFA" />
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={14}
                color="$accentTrainer"
              >
                Add question
              </Text>
            </View>
          </Pressable>
        ) : null}
        {p.problem ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            marginTop={6}
            accessibilityRole="alert"
            testID="form-editor-problem"
          >
            {p.problem}
          </Text>
        ) : null}
        <Text
          fontFamily="$body"
          fontSize={12}
          lineHeight={17}
          color="$text3"
          marginTop={14}
        >
          Questions marked “Filled for them” come from what the client already
          logs. They can still change the answer before sending.
        </Text>
      </ScrollView>
    </View>
  );
}

function QuestionItem({
  q,
  index,
  p,
}: {
  q: Question;
  index: number;
  p: FormEditorPresenterProps;
}) {
  const open = p.openIndex === index;
  const id = `form-editor-q-${index}`;
  const set = (patch: Partial<Question>) =>
    p.onChangeQuestion(index, { ...q, ...patch });
  const sources = prefillSourcesFor(q.type);
  return (
    <View borderBottomWidth={1} borderBottomColor="$border">
      <Pressable
        onPress={() => p.onOpen(open ? null : index)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        accessibilityLabel={`Question ${index + 1}: ${q.prompt || "New question"}`}
        testID={id}
      >
        <View
          flexDirection="row"
          alignItems="center"
          gap={12}
          paddingVertical={11}
        >
          <Text
            fontFamily="$mono"
            fontWeight="600"
            fontSize={13}
            color="$accentTrainer"
            width={20}
          >
            {index + 1}
          </Text>
          <View flex={1} minWidth={0} gap={2}>
            <Text
              fontFamily="$body"
              fontWeight="600"
              fontSize={15}
              color={q.prompt ? "$text" : "$text4"}
              numberOfLines={1}
            >
              {q.prompt || "New question"}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={12.5}
              color="$text3"
              numberOfLines={1}
            >
              {questionSubtitle(q)}
            </Text>
          </View>
          {q.prefill ? (
            <StatusPill tone="review" text="Filled for them" />
          ) : null}
        </View>
      </Pressable>
      {open ? (
        <View paddingBottom={14} testID={`${id}-fields`}>
          <FieldLabel top={4}>Question</FieldLabel>
          <FieldInput
            value={q.prompt}
            onChangeText={(prompt) => set({ prompt })}
            placeholder="Ask something"
            accessibilityLabel="Question"
            maxLength={300}
            testID={`${id}-prompt`}
          />
          <FieldLabel>Help text, optional</FieldLabel>
          <FieldInput
            value={q.help ?? ""}
            onChangeText={(help) => set({ help })}
            placeholder="A line under the question"
            accessibilityLabel="Help text"
            maxLength={300}
            testID={`${id}-help`}
          />
          <FieldLabel>Answer type</FieldLabel>
          <ChoiceChips
            label="Answer type"
            options={QUESTION_TYPES.map((t) => ({
              value: t,
              label: QUESTION_TYPE_LABELS[t],
            }))}
            value={q.type}
            onChange={(t) => p.onRetype(index, t)}
            testID={`${id}-type`}
          />

          {q.type === "single_choice" || q.type === "multiple_choice" ? (
            <View>
              <FieldLabel>Options</FieldLabel>
              {(q.options ?? []).map((o, oi) => (
                <View
                  key={oi}
                  flexDirection="row"
                  alignItems="center"
                  gap={8}
                  marginBottom={6}
                >
                  <View flex={1}>
                    <FieldInput
                      value={o}
                      onChangeText={(v) =>
                        set({
                          options: (q.options ?? []).map((x, xi) =>
                            xi === oi ? v : x,
                          ),
                        })
                      }
                      accessibilityLabel={`Option ${oi + 1}`}
                      maxLength={100}
                      testID={`${id}-option-${oi}`}
                    />
                  </View>
                  <Pressable
                    onPress={() =>
                      set({
                        options: (q.options ?? []).filter((_, xi) => xi !== oi),
                      })
                    }
                    disabled={(q.options ?? []).length <= 2}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove option ${oi + 1}`}
                    testID={`${id}-option-${oi}-remove`}
                    style={{
                      width: 40,
                      height: 40,
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    <IconX size={16} color="#8A8A98" />
                  </Pressable>
                </View>
              ))}
              <LinkButton
                onPress={() =>
                  set({
                    options: [
                      ...(q.options ?? []),
                      `Option ${(q.options ?? []).length + 1}`,
                    ],
                  })
                }
                disabled={(q.options ?? []).length >= MAX_OPTIONS}
                testID={`${id}-add-option`}
              >
                + Add option
              </LinkButton>
            </View>
          ) : null}

          {q.type === "number" ? (
            <View flexDirection="row" gap={8}>
              <View flex={1}>
                <FieldLabel>Lowest</FieldLabel>
                <FieldInput
                  value={q.min === undefined ? "" : String(q.min)}
                  onChangeText={(v) => set({ min: numberOrUndefined(v) })}
                  accessibilityLabel="Lowest"
                  keyboardType="numbers-and-punctuation"
                  testID={`${id}-min`}
                />
              </View>
              <View flex={1}>
                <FieldLabel>Highest</FieldLabel>
                <FieldInput
                  value={q.max === undefined ? "" : String(q.max)}
                  onChangeText={(v) => set({ max: numberOrUndefined(v) })}
                  accessibilityLabel="Highest"
                  keyboardType="numbers-and-punctuation"
                  testID={`${id}-max`}
                />
              </View>
              <View flex={1}>
                <FieldLabel>Unit</FieldLabel>
                <FieldInput
                  value={q.unit ?? ""}
                  onChangeText={(unit) => set({ unit })}
                  placeholder="kg"
                  accessibilityLabel="Unit"
                  maxLength={20}
                  testID={`${id}-unit`}
                />
              </View>
            </View>
          ) : null}

          {sources.length > 0 ? (
            <View>
              <FieldLabel>Filled for them</FieldLabel>
              <ChoiceChips<"none" | PrefillSource>
                label="Filled for them"
                options={[
                  { value: "none", label: "No" },
                  ...sources.map((s) => ({
                    value: s,
                    label: PREFILL_LABELS[s],
                  })),
                ]}
                value={q.prefill ?? "none"}
                onChange={(v) => {
                  const next: Question = { ...q };
                  if (v === "none") delete next.prefill;
                  else next.prefill = v;
                  p.onChangeQuestion(index, next);
                }}
                testID={`${id}-prefill`}
              />
            </View>
          ) : null}

          <View marginTop={8}>
            <ToggleRow
              label="Required"
              detail="They can’t send the form without it."
              value={q.required}
              onChange={(required) => set({ required })}
              testID={`${id}-required`}
            />
            {q.type === "yes_no" ? (
              <ToggleRow
                label="Ask for details if yes"
                detail="Shows a text box when they answer yes."
                value={q.detailsIfYes === true}
                onChange={(on) => {
                  const next: Question = { ...q };
                  if (on) next.detailsIfYes = true;
                  else delete next.detailsIfYes;
                  p.onChangeQuestion(index, next);
                }}
                testID={`${id}-details`}
              />
            ) : null}
          </View>

          <View flexDirection="row" flexWrap="wrap" gap={16} marginTop={6}>
            <LinkButton
              onPress={() => p.onMove(index, -1)}
              disabled={index === 0}
              testID={`${id}-up`}
            >
              Move up
            </LinkButton>
            <LinkButton
              onPress={() => p.onMove(index, 1)}
              disabled={index === p.questions.length - 1}
              testID={`${id}-down`}
            >
              Move down
            </LinkButton>
            <LinkButton
              onPress={() => p.onDuplicate(index)}
              disabled={p.questions.length >= MAX_QUESTIONS}
              testID={`${id}-duplicate`}
            >
              Duplicate
            </LinkButton>
            <Pressable
              onPress={() => p.onDelete(index)}
              accessibilityRole="button"
              testID={`${id}-delete`}
              style={{ minHeight: 40, justifyContent: "center" }}
            >
              <Text
                fontFamily="$body"
                fontWeight="600"
                fontSize={13}
                color="$error"
              >
                Delete
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
    </View>
  );
}

function numberOrUndefined(v: string): number | undefined {
  const t = v.trim();
  if (t === "" || t === "-") return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}
