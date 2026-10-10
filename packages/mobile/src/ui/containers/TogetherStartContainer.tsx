import { TogetherWorkoutChoice } from "@/ui/presenters/TogetherWorkoutChoice";
import { useEffect, useRef, useState } from "react";
import { ScrollView } from "react-native";
import { router } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useWorkouts } from "@/ui/hooks/useWorkouts";
import { useTogetherGate } from "@/ui/hooks/useTogetherGate";
import { startSessionCommand } from "@/application/commands/session";
import { TogetherAudienceOptions } from "@/ui/presenters/TogetherAudienceOptions";
import { Btn, Card, HeaderBar } from "@/ui/components/foundation";
import type {
  TogetherLobbyAudience,
  TogetherTransport,
} from "@/domain/ports/togetherLobby.port";

/** Guided start uses cached workouts and the same account-bound host intent as detail. */
export function TogetherStartContainer() {
  const { storage, togetherLobby: lobby, togetherCloud: cloud } = useAdapters();
  const { session: auth } = useAuth();
  const userId = auth?.userId;
  const gate = useTogetherGate();
  const workouts = useWorkouts();
  const insets = useSafeAreaInsets();
  const [selected, setSelected] = useState<string | null>(null);
  const [step, setStep] = useState(1);
  const [audience, setAudience] = useState<TogetherLobbyAudience>("open");
  const [transport, setTransport] = useState<TogetherTransport>("lan");
  const [connection, setConnection] = useState<"local" | "online">("local");
  const [error, setError] = useState("");
  const locked = useRef(false);
  const owner = useRef(userId);
  owner.current = userId;
  useEffect(() => {
    setSelected(null);
    setStep(1);
    setAudience("open");
    setConnection("local");
    setError("");
  }, [userId]);
  const choices = [
    ...new Map(
      [
        ...workouts.mine.workouts,
        ...workouts.assigned.workouts,
        ...workouts.default.workouts,
      ]
        .filter((w) => w.variationKind !== "loadout")
        .map((w) => [w.id, w]),
    ).values(),
  ];
  const chosen = choices.find((w) => w.id === selected);
  const active = userId ? storage.getActiveSession(userId) : null;
  const start = () => {
    if (!userId || !gate.allowed || locked.current || (!chosen && !active))
      return;
    locked.current = true;
    try {
      const fresh = storage.getActiveSession(userId);
      if (fresh?.together) {
        router.replace("/(app)/session" as never);
        return;
      }
      if (fresh?.withClient || fresh?.retrospectiveCompletedAt)
        throw new Error("personal-workout-required");
      const phase = lobby?.getSnapshot().phase;
      if (phase && !["idle", "disabled"].includes(phase))
        throw new Error("connection-busy");
      if (connection === "local") {
        if (!lobby) throw new Error("local-unavailable");
        lobby.selectTransport?.(transport);
      } else if (!cloud) throw new Error("online-unavailable");
      const result = fresh
        ? { ok: true as const, value: fresh }
        : startSessionCommand(
            { storage, userId, generateId: randomUUID },
            { workout: chosen },
          );
      if (!result.ok || owner.current !== userId)
        throw new Error("workout-changed");
      router.replace({
        pathname: "/(app)/session",
        params: {
          togetherAccountId: userId,
          togetherAudience: audience,
          togetherConnection: connection,
        },
      } as never);
    } catch {
      setError(
        "Could not start sharing. Your workout has been kept. Return to it or try again.",
      );
    } finally {
      locked.current = false;
    }
  };
  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <HeaderBar
        title="Start Together"
        leading={
          <Btn
            variant="ghost"
            onPress={() => (step > 1 ? setStep(step - 1) : router.back())}
          >
            Back
          </Btn>
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View gap={16}>
          <Text fontFamily="$body" color="$primary">
            STEP {step} OF 3
          </Text>
          {!gate.allowed ? (
            <>
              <Text color="$text2">
                {gate.state === "locked"
                  ? "Every athlete needs a qualifying paid subscription."
                  : "Checking your Together access…"}
              </Text>
              <Btn
                onPress={gate.state === "locked" ? gate.onUpgrade : gate.retry}
              >
                Check access
              </Btn>
            </>
          ) : step === 1 ? (
            <>
              <Text fontFamily="$display" fontSize={24} color="$text">
                Choose your workout
              </Text>
              {active ? (
                <Card>
                  <View gap={10}>
                    <Text color="$text">{active.name}</Text>
                    <Text color="$text2">
                      Continue your current workout. Your logged sets stay in
                      place.
                    </Text>
                    <Btn onPress={() => setStep(2)}>Use my current workout</Btn>
                  </View>
                </Card>
              ) : (
                <>
                  {!choices.length && (
                    <Text color="$text2">
                      {workouts.isRefreshing
                        ? "Loading your workouts…"
                        : "No workouts available. Create a workout first."}
                    </Text>
                  )}
                  {choices.map((w) => (
                    <TogetherWorkoutChoice
                      key={w.id}
                      name={w.name}
                      exerciseCount={w.exercises.length}
                      minutes={w.estimatedDurationMinutes}
                      exerciseNames={w.exercises.flatMap((e) =>
                        e.exercise?.name ? [e.exercise.name] : [],
                      )}
                      onPress={() => {
                        setSelected(w.id);
                        setStep(2);
                      }}
                    />
                  ))}
                  {!choices.length && (
                    <Btn
                      onPress={() =>
                        router.push("/(app)/workouts/create" as never)
                      }
                    >
                      Create a workout
                    </Btn>
                  )}
                </>
              )}
            </>
          ) : step === 2 ? (
            <>
              <Text fontFamily="$display" fontSize={24} color="$text">
                Who can join?
              </Text>
              <TogetherAudienceOptions
                audience={audience}
                onAudienceChange={(a) => {
                  setAudience(a);
                  setConnection("local");
                }}
                trainingPartners={{
                  selected: audience === "friends",
                  onSelect: () => setAudience("friends"),
                }}
              />
              <Text color="$text2">
                Up to four athletes. Joining never shares previous values or
                grants permission to log for someone.
              </Text>
              <Btn onPress={() => setStep(3)}>Next · choose connection</Btn>
            </>
          ) : (
            <>
              <Text fontFamily="$display" fontSize={24} color="$text">
                Connect and start
              </Text>
              <Text color="$text">{active?.name ?? chosen?.name}</Text>
              {(lobby?.transports ?? ["lan"]).map((t) => (
                <Btn
                  key={t}
                  variant={
                    connection === "local" && transport === t
                      ? "soft"
                      : "outline"
                  }
                  onPress={() => {
                    setConnection("local");
                    setTransport(t);
                  }}
                >
                  {t === "lan"
                    ? "Same Wi-Fi or hotspot"
                    : t === "nearby"
                      ? "Nearby phones"
                      : "This Android phone’s hotspot"}
                </Btn>
              ))}
              {audience === "friends" && cloud && (
                <Btn
                  variant={connection === "online" ? "soft" : "outline"}
                  onPress={() => setConnection("online")}
                >
                  Online · internet required
                </Btn>
              )}
              <Text color="$text2">
                {connection === "online"
                  ? "Partners join online or through your invitation link."
                  : transport === "nearby"
                    ? "Keep phones nearby and enable the requested local permissions."
                    : "Connect every phone to the same Wi-Fi or manually enabled hotspot. Internet is not required with valid cached access."}
              </Text>
              <Text color="$text2">
                Start creates your live session. Others can then join from
                Together or scan your invitation. Each athlete logs and saves
                their own workout.
              </Text>
              <Btn onPress={start}>Start Together session</Btn>
            </>
          )}
          {!!error && (
            <Text color="$warning" accessibilityRole="alert">
              {error}
            </Text>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
