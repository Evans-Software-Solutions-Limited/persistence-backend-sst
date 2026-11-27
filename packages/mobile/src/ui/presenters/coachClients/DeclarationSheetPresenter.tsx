import { Modal, Pressable, ScrollView } from "react-native";
import { Text, View } from "@tamagui/core";

import { Btn } from "@/ui/components/foundation";
import { IconCheck } from "@/ui/components/icons";
import {
  DECLARATION_CONFIRM_LABEL,
  DECLARATION_FOOTNOTE,
  DECLARATION_INTRO,
  DECLARATION_POINTS,
  DECLARATION_TITLE,
} from "@/domain/models/coachDeclaration";
import { ErrorLine } from "./kit";

/**
 * The coach declaration (design A D6b), asked before the first personal
 * invite. The wording is a DRAFT shared with web (see coachDeclaration.ts).
 */
export type DeclarationSheetPresenterProps = {
  visible: boolean;
  agreed: boolean;
  error: string | null;
  busy: boolean;
  onToggle: (agreed: boolean) => void;
  onConfirm: () => void;
  onClose: () => void;
};

export function DeclarationSheetPresenter(p: DeclarationSheetPresenterProps) {
  return (
    <Modal
      visible={p.visible}
      transparent
      animationType="fade"
      onRequestClose={p.onClose}
      testID="declaration"
    >
      <View
        flex={1}
        backgroundColor="rgba(5,6,10,0.62)"
        justifyContent="center"
        padding={20}
      >
        <View
          backgroundColor="$surface"
          borderWidth={1}
          borderColor="$border2"
          borderRadius={20}
          padding={20}
          maxHeight="90%"
        >
          <ScrollView>
            <Text
              fontFamily="$display"
              fontWeight="700"
              fontSize={20}
              color="$text"
              accessibilityRole="header"
            >
              {DECLARATION_TITLE}
            </Text>
            <Text
              fontFamily="$body"
              fontSize={13}
              lineHeight={18}
              color="$text2"
              marginTop={8}
            >
              {DECLARATION_INTRO}
            </Text>
            {DECLARATION_POINTS.map((point) => (
              <View key={point} flexDirection="row" gap={8} marginTop={8}>
                <Text fontFamily="$body" fontSize={13} color="$text3">
                  •
                </Text>
                <Text
                  flex={1}
                  fontFamily="$body"
                  fontSize={13}
                  lineHeight={18}
                  color="$text"
                >
                  {point}
                </Text>
              </View>
            ))}
            <Text
              fontFamily="$body"
              fontSize={12}
              lineHeight={17}
              color="$text3"
              marginTop={10}
            >
              {DECLARATION_FOOTNOTE}
            </Text>
            <Pressable
              onPress={() => p.onToggle(!p.agreed)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: p.agreed }}
              testID="declaration-tick"
              style={{ marginTop: 14, minHeight: 44, justifyContent: "center" }}
            >
              <View flexDirection="row" alignItems="center" gap={10}>
                <View
                  width={24}
                  height={24}
                  borderRadius={7}
                  alignItems="center"
                  justifyContent="center"
                  borderWidth={p.agreed ? 0 : 1.5}
                  borderColor="$text4"
                  backgroundColor={p.agreed ? "$accentTrainer" : "transparent"}
                >
                  {p.agreed ? <IconCheck size={14} color="#1E1B4B" /> : null}
                </View>
                <Text
                  flex={1}
                  fontFamily="$body"
                  fontWeight="600"
                  fontSize={14}
                  color="$text"
                >
                  {DECLARATION_CONFIRM_LABEL}
                </Text>
              </View>
            </Pressable>
            {p.error ? (
              <ErrorLine testID="declaration-error">{p.error}</ErrorLine>
            ) : null}
            <View flexDirection="row" gap={10} marginTop={14}>
              <View flex={1}>
                <Btn
                  variant="outline"
                  tone="trainer"
                  full
                  onPress={p.onClose}
                  disabled={p.busy}
                  testID="declaration-cancel"
                >
                  Not now
                </Btn>
              </View>
              <View flex={1}>
                <Btn
                  variant="filled"
                  tone="trainer"
                  full
                  onPress={p.onConfirm}
                  disabled={p.busy}
                  testID="declaration-confirm"
                >
                  {p.busy ? "Saving…" : "Confirm"}
                </Btn>
              </View>
            </View>
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}
