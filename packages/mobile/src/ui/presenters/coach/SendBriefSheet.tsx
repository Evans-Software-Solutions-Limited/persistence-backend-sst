import { useCallback, useEffect, useState } from "react";
import { TextInput } from "react-native";
import { Text, View } from "@tamagui/core";
import { BottomSheet } from "@/ui/components/foundation/BottomSheet";
import { Btn } from "@/ui/components/foundation/Btn";
import { useSendBriefSheet } from "@/state/send-brief-sheet";
import { useAdapters } from "@/ui/hooks/useAdapters";

/**
 * <SendBriefSheet> — coach sends a client a short free-text brief (M17).
 * Root-mounted; opened from Client Detail's Quick Actions. The client gets a
 * `coach_brief` notification (+ best-effort push) deep-linking their Training
 * page, so the composer frames the message as "what to look at".
 *
 * ONLINE-ONLY (direct adapter call, never the sync queue — mirrors the other
 * coach writes). Mirrors <CoachNoteSheet>'s structure.
 */

/** Keep in sync with the backend `CLIENT_BRIEF_MAX_LENGTH`. */
export const BRIEF_MAX_LENGTH = 500;

export function SendBriefSheet() {
  const open = useSendBriefSheet((s) => s.open);
  const clientId = useSendBriefSheet((s) => s.clientId);
  const clientName = useSendBriefSheet((s) => s.clientName);
  const closeSheet = useSendBriefSheet((s) => s.closeSheet);

  const { api } = useAdapters();

  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMessage("");
    setError(null);
    setSubmitting(false);
  }, [open]);

  const trimmed = message.trim();
  const canSend = clientId !== null && trimmed !== "" && !submitting;

  const handleSend = useCallback(async () => {
    if (!canSend || clientId === null) return;
    setError(null);
    setSubmitting(true);
    const result = await api.sendClientBrief(clientId, { message: trimmed });
    setSubmitting(false);
    if (result.ok) {
      closeSheet();
      return;
    }
    setError("Couldn’t send the brief. Please try again.");
  }, [api, canSend, clientId, trimmed, closeSheet]);

  return (
    <BottomSheet
      visible={open}
      onClose={closeSheet}
      title="Send brief"
      accent="trainer"
      height="default"
    >
      <View gap={16} testID="send-brief-sheet">
        <View gap={8}>
          <Text
            fontFamily="$display"
            fontSize={10.5}
            fontWeight="600"
            letterSpacing={1.7}
            textTransform="uppercase"
            color="$text3"
          >
            {clientName ? `Brief for ${clientName}` : "Brief"}
          </Text>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="e.g. Your new block starts Monday — check your Training page"
            placeholderTextColor="#8A8A98"
            multiline
            autoCorrect
            maxLength={BRIEF_MAX_LENGTH}
            testID="send-brief-message"
            style={{
              minHeight: 120,
              borderRadius: 12,
              borderWidth: 1,
              borderColor: "#232735",
              backgroundColor: "#1A1D29",
              paddingHorizontal: 14,
              paddingTop: 12,
              paddingBottom: 12,
              color: "#F4F4F8",
              fontSize: 14,
              textAlignVertical: "top",
            }}
          />
          <Text
            fontFamily="$body"
            fontSize={11}
            color="$text3"
            textAlign="right"
            testID="send-brief-count"
          >
            {`${message.length}/${BRIEF_MAX_LENGTH}`}
          </Text>
        </View>

        <Text fontFamily="$body" fontSize={12.5} color="$text3">
          They’ll get a notification that opens their Training page.
        </Text>

        {error ? (
          <Text
            fontFamily="$body"
            fontSize={13}
            color="$error"
            testID="send-brief-error"
          >
            {error}
          </Text>
        ) : null}

        <Btn
          variant="filled"
          tone="trainer"
          disabled={!canSend}
          onPress={handleSend}
          testID="send-brief-submit"
        >
          {submitting ? "Sending…" : "Send brief"}
        </Btn>
      </View>
    </BottomSheet>
  );
}
