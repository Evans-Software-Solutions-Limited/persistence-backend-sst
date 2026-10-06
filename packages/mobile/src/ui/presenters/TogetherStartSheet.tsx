import { Text, View } from "@tamagui/core";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import { TogetherAudienceOptions } from "./TogetherAudienceOptions";
import type {
  TogetherLobbyAudience,
  TogetherTransport,
} from "@/domain/ports/togetherLobby.port";

/** Configuration only: no personal workout or network session exists until Start. */
export function TogetherStartSheet({
  visible,
  activeWorkoutName,
  audience,
  transport,
  onAudienceChange,
  onStart,
  onClose,
  trainingPartnersAvailable,
}: {
  visible: boolean;
  activeWorkoutName?: string;
  trainingPartnersAvailable?: boolean;
  audience: TogetherLobbyAudience | "friends";
  transport?: TogetherTransport;
  onAudienceChange(value: TogetherLobbyAudience | "friends"): void;
  onStart(): void;
  onClose(): void;
}) {
  return (
    <BottomSheet
      visible={visible}
      onClose={onClose}
      title="Who can join?"
      eyebrow="Train together"
      footer={
        <View gap={8}>
          <Btn full onPress={onStart}>
            Start the session
          </Btn>
          <Btn full variant="ghost" onPress={onClose}>
            Cancel
          </Btn>
        </View>
      }
    >
      <View gap={12}>
        {activeWorkoutName ? (
          <Text
            color="$text2"
            fontFamily="$body"
            fontSize={13}
            marginBottom={12}
          >
            You already have an active workout: {activeWorkoutName}. Starting
            Together continues that workout and keeps its logged sets.
          </Text>
        ) : null}
        <Text color="$text2" fontFamily="$body" fontSize={13}>
          Up to four athletes. Everyone needs a qualifying paid subscription.
          Everyone logs and saves their own workout.
        </Text>
        <TogetherAudienceOptions
          audience={audience === "friends" ? "invite-only" : audience}
          trainingPartners={
            trainingPartnersAvailable
              ? {
                  selected: audience === "friends",
                  onSelect: () => onAudienceChange("friends"),
                }
              : undefined
          }
          onAudienceChange={onAudienceChange}
          transport={transport}
        />
        <Text color="$text3" fontFamily="$body" fontSize={12}>
          Accepted training partners join deliberately. Anyone else needs your
          approval. Joining never grants access to history or permission to log
          for someone.
        </Text>
      </View>
    </BottomSheet>
  );
}
