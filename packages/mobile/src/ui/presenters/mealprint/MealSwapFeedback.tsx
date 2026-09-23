import { Pressable, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation";
import { MAX_STEER_LENGTH } from "@/domain/models/mealprint";

export type MealSwapFeedbackProps = {
  readonly mealId: string;
  readonly value: string;
  readonly onChange: (value: string) => void;
  readonly onGenerate: () => void;
  readonly onCancel: () => void;
  readonly busy: boolean;
  readonly disabled?: boolean;
  readonly error: string | null;
};

/** One-request feedback; saved food preferences still apply. */
export function MealSwapFeedback(props: MealSwapFeedbackProps) {
  const { value, onChange, onGenerate, onCancel, busy, disabled, error } =
    props;
  return (
    <View gap={10} padding={14} testID="meal-swap-feedback">
      <Text fontFamily="$display" fontWeight="600" fontSize={14} color="$text">
        What would work better?
      </Text>
      <Text fontFamily="$body" fontSize={12} color="$text3">
        Optional, just for this swap. Your food preferences still apply.
      </Text>
      <View flexDirection="row" flexWrap="wrap" gap={6}>
        {["High protein", "Quick to make", "Chicken based"].map((label) => (
          <Pressable
            key={label}
            accessibilityRole="button"
            accessibilityLabel={label}
            disabled={busy}
            onPress={() => onChange(label)}
          >
            <View
              paddingHorizontal={10}
              paddingVertical={8}
              borderRadius={10}
              backgroundColor="$surface3"
              borderWidth={1}
              borderColor={value === label ? "$gold" : "$border2"}
            >
              <Text fontFamily="$body" fontSize={12} color="$text2">
                {label}
              </Text>
            </View>
          </Pressable>
        ))}
      </View>
      <TextInput
        value={value}
        onChangeText={onChange}
        editable={!busy}
        maxLength={MAX_STEER_LENGTH}
        multiline
        accessibilityLabel="Swap feedback"
        testID="meal-swap-feedback-input"
        placeholder="e.g. Something warm with chicken"
        placeholderTextColor="#70707E"
        style={{
          color: "#F0F0F4",
          backgroundColor: "#19191F",
          borderColor: "#30303A",
          borderWidth: 1,
          borderRadius: 10,
          padding: 12,
          minHeight: 76,
          fontSize: 14,
          textAlignVertical: "top",
        }}
      />
      {error ? (
        <Text
          fontFamily="$body"
          accessibilityRole="alert"
          fontSize={12}
          color="$error"
          testID="meal-swap-feedback-error"
        >
          {error}
        </Text>
      ) : null}
      <View gap={8}>
        <Btn
          full
          tone="gold"
          onPress={onGenerate}
          disabled={busy || disabled}
          testID="meal-swap-feedback-generate"
        >
          {busy ? "Finding a replacement…" : "Generate replacement"}
        </Btn>
        <Btn
          variant="ghost"
          onPress={onCancel}
          disabled={busy}
          testID="meal-swap-feedback-cancel"
        >
          Cancel
        </Btn>
      </View>
    </View>
  );
}
