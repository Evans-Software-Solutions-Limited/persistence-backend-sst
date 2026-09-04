import {
  View,
  styled,
  Text as TamaguiText,
  useTheme as useTamaguiTheme,
} from "@tamagui/core";
import { useState } from "react";
import { Pressable, TextInput, type TextInputProps } from "react-native";
import { IconEye, IconEyeOff } from "./icons";

const InputContainer = styled(View, {
  gap: "$xs",
});

const Label = styled(TamaguiText, {
  color: "$colorSecondary",
  fontSize: 14,
  lineHeight: 20,
  fontWeight: "500",
  fontFamily: "$body",
});

const HelperText = styled(TamaguiText, {
  fontSize: 12,
  lineHeight: 16,
  fontFamily: "$body",

  variants: {
    error: {
      true: { color: "$error" },
      false: { color: "$colorMuted" },
    },
  } as const,
});

type InputProps = {
  label?: string;
  placeholder?: string;
  value?: string;
  onChangeText?: (text: string) => void;
  error?: string;
  helperText?: string;
  secureTextEntry?: boolean;
  /** Adds an accessible Show/Hide control while keeping the value controlled. */
  showPasswordToggle?: boolean;
  isDisabled?: boolean;
  testID?: string;
} & Omit<
  TextInputProps,
  "style" | "placeholderTextColor" | "editable" | "secureTextEntry"
>;

export function Input({
  label,
  placeholder,
  value,
  onChangeText,
  error,
  helperText,
  secureTextEntry = false,
  showPasswordToggle = false,
  isDisabled = false,
  testID,
  ...rest
}: InputProps) {
  const [isFocused, setIsFocused] = useState(false);
  const [isPasswordVisible, setIsPasswordVisible] = useState(false);
  const theme = useTamaguiTheme();

  const borderColor = error
    ? theme.borderColorError?.val
    : isFocused
      ? theme.borderColorFocus?.val
      : theme.borderColor?.val;

  return (
    <InputContainer testID={testID}>
      {label && <Label>{label}</Label>}
      <View position="relative">
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={theme.placeholderColor?.val}
          secureTextEntry={secureTextEntry && !isPasswordVisible}
          editable={!isDisabled}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          testID={testID ? `${testID}-input` : undefined}
          accessibilityLabel={label}
          style={{
            minHeight: 44,
            backgroundColor: theme.surfaceTertiary?.val,
            borderWidth: 1,
            borderColor,
            borderRadius: 8,
            paddingLeft: 16,
            paddingRight: showPasswordToggle ? 52 : 16,
            paddingVertical: 12,
            color: theme.color?.val,
            fontSize: 16,
            opacity: isDisabled ? 0.5 : 1,
          }}
          {...rest}
        />
        {secureTextEntry && showPasswordToggle ? (
          <Pressable
            onPress={() => setIsPasswordVisible((visible) => !visible)}
            disabled={isDisabled}
            accessibilityRole="button"
            accessibilityLabel={
              isPasswordVisible ? "Hide password" : "Show password"
            }
            hitSlop={8}
            testID={testID ? `${testID}-visibility-toggle` : undefined}
            style={{
              position: "absolute",
              right: 14,
              top: 0,
              bottom: 0,
              justifyContent: "center",
              opacity: isDisabled ? 0.5 : 1,
            }}
          >
            {isPasswordVisible ? (
              <IconEyeOff size={20} color={theme.colorMuted?.val} />
            ) : (
              <IconEye size={20} color={theme.colorMuted?.val} />
            )}
          </Pressable>
        ) : null}
      </View>
      {(error ?? helperText) && (
        <HelperText error={!!error}>{error ?? helperText}</HelperText>
      )}
    </InputContainer>
  );
}
