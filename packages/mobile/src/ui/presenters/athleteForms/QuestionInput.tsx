import { Pressable, TextInput } from "react-native";
import { Image } from "expo-image";
import { Text, View } from "@tamagui/core";

import { IconCamera, IconCheck } from "@/ui/components/icons";
import type {
  AnswerValue,
  PhotoAnswer,
  YesNoAnswer,
} from "@/domain/models/athleteForms";
import type { Question } from "@/domain/models/coachForms";

/**
 * PER-130 (C4f): one question's answer control. Pure: the value comes in,
 * changes go out through `onChange`; the container's react-hook-form owns
 * them. Styles follow the C4f / C10 boards (`.chip`, `.row`, the dashed
 * photo slot), in the app's tokens.
 */

export type QuestionInputProps = {
  question: Question;
  value: AnswerValue;
  onChange(value: AnswerValue): void;
  onAddPhoto(): void;
  testID?: string;
};

const INPUT_STYLE = {
  minHeight: 52,
  borderRadius: 14,
  borderWidth: 1,
  borderColor: "rgba(255,255,255,0.10)",
  backgroundColor: "#12141D",
  color: "#F4F4F8",
  paddingHorizontal: 14,
  paddingVertical: 14,
  fontSize: 16,
  fontFamily: "Geist",
} as const;

function Choice(p: {
  label: string;
  selected: boolean;
  multi: boolean;
  onPress(): void;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole={p.multi ? "checkbox" : "radio"}
      accessibilityState={
        p.multi ? { checked: p.selected } : { selected: p.selected }
      }
      accessibilityLabel={p.label}
      testID={p.testID}
    >
      <View
        minHeight={52}
        flexDirection="row"
        alignItems="center"
        gap={12}
        paddingHorizontal={14}
        borderRadius={14}
        borderWidth={1}
        borderColor={p.selected ? "rgba(167,139,250,0.5)" : "$border2"}
        backgroundColor={p.selected ? "rgba(167,139,250,0.14)" : "$surface"}
      >
        <View
          width={20}
          height={20}
          borderRadius={p.multi ? 6 : 9999}
          borderWidth={1.5}
          borderColor={p.selected ? "$accentTrainer" : "$border3"}
          backgroundColor={p.selected ? "$accentTrainer" : "transparent"}
          alignItems="center"
          justifyContent="center"
        >
          {p.selected ? <IconCheck size={13} color="#1E1B4B" /> : null}
        </View>
        <Text flex={1} fontFamily="$body" fontSize={15} color="$text">
          {p.label}
        </Text>
      </View>
    </Pressable>
  );
}

function Seg(p: {
  label: string;
  selected: boolean;
  onPress(): void;
  accessibilityLabel?: string;
  testID?: string;
}) {
  return (
    <Pressable
      onPress={p.onPress}
      accessibilityRole="radio"
      accessibilityState={{ selected: p.selected }}
      accessibilityLabel={p.accessibilityLabel ?? p.label}
      style={{ flex: 1 }}
      testID={p.testID}
    >
      <View
        height={52}
        borderRadius={14}
        borderWidth={1}
        borderColor={p.selected ? "rgba(167,139,250,0.5)" : "$border2"}
        backgroundColor={p.selected ? "rgba(167,139,250,0.14)" : "$surface"}
        alignItems="center"
        justifyContent="center"
      >
        <Text
          fontFamily="$body"
          fontWeight="600"
          fontSize={16}
          color={p.selected ? "$text" : "$text2"}
        >
          {p.label}
        </Text>
      </View>
    </Pressable>
  );
}

function PhotoSlot(p: { value: PhotoAnswer; onAdd(): void; testID?: string }) {
  if (p.value.uri) {
    return (
      <View flexDirection="row" alignItems="flex-end" gap={12}>
        <Image
          source={{ uri: p.value.uri }}
          style={{ width: 108, height: 150, borderRadius: 12 }}
          contentFit="cover"
          accessibilityLabel="Your photo"
          testID={p.testID ? `${p.testID}-image` : undefined}
        />
        <Pressable
          onPress={p.onAdd}
          accessibilityRole="button"
          accessibilityLabel="Retake photo"
          hitSlop={10}
          testID={p.testID ? `${p.testID}-retake` : undefined}
        >
          <Text
            fontFamily="$body"
            fontWeight="600"
            fontSize={13}
            color="$accentTrainer"
          >
            Retake
          </Text>
        </Pressable>
      </View>
    );
  }
  return (
    <Pressable
      onPress={p.onAdd}
      accessibilityRole="button"
      accessibilityLabel="Add photo"
      testID={p.testID ? `${p.testID}-add` : undefined}
    >
      <View
        width={108}
        height={150}
        borderRadius={12}
        borderWidth={1.5}
        borderStyle="dashed"
        borderColor="rgba(167,139,250,0.6)"
        alignItems="center"
        justifyContent="center"
        gap={6}
      >
        <IconCamera size={20} color="#C4B5FD" />
        <Text
          fontFamily="$body"
          fontWeight="600"
          fontSize={12}
          color="$accentTrainerBright"
        >
          Add photo
        </Text>
      </View>
    </Pressable>
  );
}

export function QuestionInput(p: QuestionInputProps) {
  const q = p.question;
  const id = p.testID ?? "question";
  switch (q.type) {
    case "short_text":
    case "long_text":
      return (
        <TextInput
          value={typeof p.value === "string" ? p.value : ""}
          onChangeText={(t) => p.onChange(t)}
          multiline={q.type === "long_text"}
          placeholder="Your answer"
          placeholderTextColor="#5C5C68"
          accessibilityLabel={q.prompt}
          style={[
            INPUT_STYLE,
            q.type === "long_text"
              ? { minHeight: 140, textAlignVertical: "top" }
              : null,
          ]}
          testID={`${id}-text`}
        />
      );
    case "number":
      return (
        <View flexDirection="row" alignItems="center" gap={10}>
          <TextInput
            value={typeof p.value === "string" ? p.value : ""}
            onChangeText={(t) => p.onChange(t)}
            keyboardType="decimal-pad"
            placeholder="0"
            placeholderTextColor="#5C5C68"
            accessibilityLabel={q.unit ? `${q.prompt} (${q.unit})` : q.prompt}
            style={[INPUT_STYLE, { flex: 1, fontFamily: "Geist Mono" }]}
            testID={`${id}-number`}
          />
          {q.unit ? (
            <Text fontFamily="$mono" fontSize={15} color="$text3">
              {q.unit}
            </Text>
          ) : null}
        </View>
      );
    case "scale":
      return (
        <View
          flexDirection="row"
          gap={8}
          accessibilityRole="radiogroup"
          testID={`${id}-scale`}
        >
          {[1, 2, 3, 4, 5].map((n) => (
            <Seg
              key={n}
              label={String(n)}
              selected={p.value === n}
              onPress={() => p.onChange(n)}
              accessibilityLabel={`${n} of 5`}
              testID={`${id}-scale-${n}`}
            />
          ))}
        </View>
      );
    case "single_choice":
    case "multiple_choice": {
      const multi = q.type === "multiple_choice";
      const picked = multi
        ? Array.isArray(p.value)
          ? p.value
          : []
        : typeof p.value === "string"
          ? [p.value]
          : [];
      return (
        <View gap={8} testID={`${id}-choices`}>
          {(q.options ?? []).map((o, i) => (
            <Choice
              key={o}
              label={o}
              multi={multi}
              selected={picked.includes(o)}
              onPress={() => {
                if (!multi) return p.onChange(picked.includes(o) ? null : o);
                p.onChange(
                  picked.includes(o)
                    ? picked.filter((x) => x !== o)
                    : [...picked, o],
                );
              }}
              testID={`${id}-choice-${i}`}
            />
          ))}
        </View>
      );
    }
    case "yes_no": {
      const v: YesNoAnswer =
        typeof p.value === "object" && p.value !== null && "details" in p.value
          ? p.value
          : { value: null, details: "" };
      return (
        <View gap={12}>
          <View flexDirection="row" gap={8} accessibilityRole="radiogroup">
            <Seg
              label="Yes"
              selected={v.value === true}
              onPress={() => p.onChange({ ...v, value: true })}
              testID={`${id}-yes`}
            />
            <Seg
              label="No"
              selected={v.value === false}
              onPress={() => p.onChange({ ...v, value: false })}
              testID={`${id}-no`}
            />
          </View>
          {q.detailsIfYes && v.value === true ? (
            <TextInput
              value={v.details}
              onChangeText={(t) => p.onChange({ ...v, details: t })}
              multiline
              placeholder="Tell us more"
              placeholderTextColor="#5C5C68"
              accessibilityLabel="Details"
              style={[
                INPUT_STYLE,
                { minHeight: 100, textAlignVertical: "top" },
              ]}
              testID={`${id}-details`}
            />
          ) : null}
        </View>
      );
    }
    case "photo": {
      const v: PhotoAnswer =
        typeof p.value === "object" && p.value !== null && "uri" in p.value
          ? p.value
          : { uri: null, mediaId: null };
      return (
        <PhotoSlot value={v} onAdd={p.onAddPhoto} testID={`${id}-photo`} />
      );
    }
  }
}
