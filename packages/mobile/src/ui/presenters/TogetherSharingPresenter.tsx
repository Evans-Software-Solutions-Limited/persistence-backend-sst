import { Switch } from "react-native";
import { Text, View } from "@tamagui/core";
import { Btn } from "@/ui/components/foundation/Btn";
import { Card } from "@/ui/components/foundation/Card";
import type {
  TogetherSharedSnapshot,
  TogetherSharingConsent,
} from "@/domain/ports/togetherShared.port";

export function TogetherSharingPresenter(p: {
  snapshot: TogetherSharedSnapshot;
  accountId: string;
  members: readonly { userId: string; host: boolean }[];
  role?: "host" | "guest";
  sessionLogging?: boolean;
  onSessionLogging?(enabled: boolean): void;
  onRemove?(userId: string): void;
  onConsent(userId: string, consent: TogetherSharingConsent): void;
  onDiscard?(): void;
  onClose(mode: "finish_all" | "save_own" | "leave"): void;
}) {
  const closed = p.snapshot.closures.some(
    (c) =>
      c.userId === p.accountId ||
      p.members.some((m) => m.host && m.userId === c.userId),
  );
  return (
    <View gap={12} testID="together-sharing-settings">
      <Text fontFamily="$display" fontSize={17} color="$text">
        Together settings
      </Text>
      {closed ? (
        <Text color="$text2">
          Sharing has ended. Your own workout is still available to review and
          save.
        </Text>
      ) : (
        <>
          {p.members
            .filter((m) => m.userId !== p.accountId)
            .map((m, i) => {
              const grant = p.snapshot.grants.find(
                (g) => g.ownerId === p.accountId && g.recipientId === m.userId,
              )?.consent ?? { numbers: false, prev: false, logging: false };
              return (
                <Card key={m.userId}>
                  <View gap={10}>
                    <Text fontFamily="$display" color="$text">
                      {p.snapshot.profiles[m.userId] ?? `Athlete ${i + 1}`}
                    </Text>
                    {(
                      [
                        ["numbers", "Show my numbers"],
                        ["prev", "Share my previous values"],
                        ["logging", "Let them fill in my sets"],
                      ] as const
                    )
                      .filter(
                        ([key]) => key !== "logging" || !p.onSessionLogging,
                      )
                      .map(([key, label]) => (
                        <View
                          key={key}
                          flexDirection="row"
                          alignItems="center"
                          gap={12}
                        >
                          <Text color="$text" fontFamily="$body" flex={1}>
                            {label}
                          </Text>
                          <Switch
                            accessibilityLabel={`${label} · ${p.snapshot.profiles[m.userId] ?? `Athlete ${i + 1}`}`}
                            value={grant[key]}
                            onValueChange={(value) =>
                              p.onConsent(m.userId, { ...grant, [key]: value })
                            }
                          />
                        </View>
                      ))}
                    {p.role === "host" && p.onRemove && (
                      <Btn
                        variant="ghost"
                        onPress={() => p.onRemove!(m.userId)}
                      >
                        Remove from session
                      </Btn>
                    )}
                  </View>
                </Card>
              );
            })}
          {p.onSessionLogging && (
            <Card>
              <View gap={8}>
                <View flexDirection="row" alignItems="center" gap={12}>
                  <Text color="$text" flex={1}>
                    Let others fill in my sets
                  </Text>
                  <Switch
                    accessibilityLabel="Let others fill in my sets"
                    value={p.sessionLogging ?? false}
                    onValueChange={p.onSessionLogging}
                  />
                </View>
                <Text color="$text2" fontSize={12}>
                  Applies to session participants who can see your numbers. Turn
                  it off to refuse edits still in flight.
                </Text>
              </View>
            </Card>
          )}
          {p.snapshot.deliveries.map((d) => (
            <Text key={d.recipientId} color="$text2" fontSize={12}>
              {p.snapshot.profiles[d.recipientId] ?? "Training partner"} ·
              shared view{" "}
              {d.state === "received" ? "received" : "awaiting receipt"} ·
              revision {d.revision}
            </Text>
          ))}
          <Text color="$text2" fontFamily="$body" fontSize={13}>
            These permissions are separate. Joining or becoming training
            partners never switches them on. Changes take effect when the other
            device receives them; disconnected devices must reauthorize before
            showing private values.
          </Text>
          {p.onDiscard && (
            <Btn full variant="ghost" tone="error" onPress={p.onDiscard}>
              Discard without saving
            </Btn>
          )}
          {p.role === "host" ? (
            <>
              <Btn
                full
                variant="outline"
                onPress={() => p.onClose("finish_all")}
              >
                End session for everyone
              </Btn>
              <Btn full variant="outline" onPress={() => p.onClose("save_own")}>
                Stop sharing · keep my workout
              </Btn>
            </>
          ) : (
            <Btn full variant="outline" onPress={() => p.onClose("leave")}>
              Leave sharing · keep my workout
            </Btn>
          )}
        </>
      )}
    </View>
  );
}
