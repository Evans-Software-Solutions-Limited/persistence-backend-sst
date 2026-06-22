import { ActivityIndicator, TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { toneHex } from "@/ui/components/foundation/tones";

/**
 * <AddClientSheetPresenter> — pure UI for the invite-client flow.
 * Ports the legacy `InviteClientModal` 1:1 (persistence-mobile/components/
 * trainer/InviteClientModal/InviteClientModal.tsx): title "Invite New Client",
 * subtitle "Send an invitation to a client by email", an email field, an
 * optional multiline reason field, and "Send Invitation" / "Cancel" buttons.
 *
 * Mounted in a trainer-accent <BottomSheet> at the app root (peek height,
 * matching the legacy 60% snap point). Validation + submit live in the
 * container; this presenter only renders state + raises callbacks.
 */

export type AddClientSheetPresenterProps = {
  visible: boolean;
  email: string;
  reason: string;
  emailError: string;
  isLoading: boolean;
  onEmailChange: (value: string) => void;
  onReasonChange: (value: string) => void;
  onInvite: () => void;
  onClose: () => void;
};

const ERROR_HEX = toneHex("error").base;

export function AddClientSheetPresenter({
  visible,
  email,
  reason,
  emailError,
  isLoading,
  onEmailChange,
  onReasonChange,
  onInvite,
  onClose,
}: AddClientSheetPresenterProps) {
  const sendDisabled = email.trim() === "" || isLoading;

  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      accent="trainer"
      height="peek"
      testID="add-client-sheet"
    >
      <View gap={16}>
        <View>
          <Text
            fontFamily="$display"
            fontWeight="700"
            fontSize={20}
            letterSpacing={-0.4}
            color="$text"
          >
            Invite New Client
          </Text>
          <Text fontFamily="$body" fontSize={13} color="$text2" marginTop={4}>
            Send an invitation to a client by email
          </Text>
        </View>

        <View gap={6}>
          <TextInput
            value={email}
            onChangeText={onEmailChange}
            placeholder="Client email address"
            placeholderTextColor="#8A8A98"
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            editable={!isLoading}
            accessibilityLabel="Client email address"
            testID="add-client-email-input"
            style={{
              height: 48,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: emailError ? ERROR_HEX : "#232735",
              backgroundColor: "#181B26",
              paddingHorizontal: 14,
              color: "#F4F4F8",
              fontFamily: "Geist",
              fontSize: 15,
            }}
          />
          {emailError ? (
            <Text
              fontFamily="$body"
              fontSize={12}
              color="$error"
              testID="add-client-email-error"
            >
              {emailError}
            </Text>
          ) : null}
        </View>

        <TextInput
          value={reason}
          onChangeText={onReasonChange}
          placeholder="Reason for training (optional)"
          placeholderTextColor="#8A8A98"
          multiline
          numberOfLines={4}
          editable={!isLoading}
          accessibilityLabel="Reason for training (optional)"
          testID="add-client-reason-input"
          style={{
            height: 100,
            borderRadius: 12,
            borderWidth: 1,
            borderColor: "#232735",
            backgroundColor: "#181B26",
            paddingHorizontal: 14,
            paddingTop: 12,
            textAlignVertical: "top",
            color: "#F4F4F8",
            fontFamily: "Geist",
            fontSize: 15,
          }}
        />

        <View flexDirection="row" gap={12}>
          <View flex={1}>
            <Btn
              variant="outline"
              tone="primary"
              full
              onPress={onClose}
              disabled={isLoading}
              testID="add-client-cancel"
            >
              Cancel
            </Btn>
          </View>
          <View flex={1}>
            <Btn
              variant="filled"
              tone="trainer"
              full
              onPress={onInvite}
              disabled={sendDisabled}
              icon={
                isLoading ? (
                  <ActivityIndicator
                    size="small"
                    color={toneHex("trainer").ink}
                  />
                ) : undefined
              }
              testID="add-client-send"
            >
              Send Invitation
            </Btn>
          </View>
        </View>
      </View>
    </BottomSheet>
  );
}
