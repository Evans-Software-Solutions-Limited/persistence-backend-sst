import { Text, View } from "@tamagui/core";
import type { ReactNode } from "react";

/**
 * <Field> — labeled form-field wrapper.
 * Ports ~/Downloads/handoff/design-source/screens/workout-creator.jsx `Field`.
 *
 * Renders an eyebrow label (uppercase, `$text3`, letterspaced — mirrors the
 * app's `.p-eyebrow` convention, e.g. `HeaderBar`'s eyebrow) with an optional
 * ember ` *` (required) or muted ` · optional` suffix, then `children`.
 */

export type FieldProps = {
  label: string;
  required?: boolean;
  optional?: boolean;
  children: ReactNode;
};

export function Field({
  label,
  required = false,
  optional = false,
  children,
}: FieldProps) {
  return (
    <View gap={7}>
      <Text
        fontFamily="$display"
        fontSize={10.5}
        fontWeight="600"
        letterSpacing={1.7}
        textTransform="uppercase"
        color="$text3"
      >
        {label}
        {required ? (
          <Text
            fontFamily="$display"
            fontWeight="600"
            color="$ember"
            textTransform="none"
          >
            {" "}
            *
          </Text>
        ) : null}
        {optional ? (
          <Text
            fontFamily="$display"
            fontWeight="500"
            fontSize={10}
            letterSpacing={0}
            textTransform="none"
            color="$text5"
          >
            {" "}
            · optional
          </Text>
        ) : null}
      </Text>
      {children}
    </View>
  );
}
