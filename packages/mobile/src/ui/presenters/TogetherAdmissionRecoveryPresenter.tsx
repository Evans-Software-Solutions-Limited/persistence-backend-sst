import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
export function TogetherAdmissionRecoveryPresenter(p: {
  canContinuePersonally: boolean;
  busy: boolean;
  error: string;
  onContinuePersonally(): void;
  onRetry(): void;
  onBack(): void;
}) {
  return (
    <View gap={16}>
      <Text fontFamily="$display" color="$text" fontSize={24}>
        Together has not connected
      </Text>
      <Text fontFamily="$body" color="$text2">
        {p.canContinuePersonally
          ? "Together could not start. Continue personally to finish and save your workout. Your logged work is kept."
          : "We have not confirmed whether Together started. Retry the connection before finishing so your workout is saved only once. Your logged work stays on this device."}
      </Text>
      {!!p.error && (
        <Text
          fontFamily="$body"
          accessibilityLiveRegion="polite"
          color="$error"
        >
          {p.error}
        </Text>
      )}
      <Btn
        full
        disabled={p.busy}
        onPress={p.canContinuePersonally ? p.onContinuePersonally : p.onRetry}
      >
        {p.canContinuePersonally ? "Continue personally" : "Retry connection"}
      </Btn>
      <Btn full variant="outline" onPress={p.onBack}>
        Back to workout
      </Btn>
    </View>
  );
}
