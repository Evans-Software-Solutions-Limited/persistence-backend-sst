import { useEffect, useMemo, useRef, useState } from "react";
import { router, useLocalSearchParams } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useAuth } from "@/ui/hooks/useAuth";
import { useWorkouts } from "@/ui/hooks/useWorkouts";
import { useGetHome } from "@/ui/hooks/useGetHome";
import { useTogetherGate } from "@/ui/hooks/useTogetherGate";
import { startSessionCommand } from "@/application/commands/session";
import { useTogetherSettings } from "@/state/together-settings";
import {
  TogetherPickWorkoutPresenter,
  type TogetherWorkoutOption,
} from "@/ui/presenters/TogetherPickWorkoutPresenter";
import { TogetherStartSessionPresenter } from "@/ui/presenters/TogetherStartSessionPresenter";
import { Btn, Card } from "@/ui/components/foundation";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { TogetherLobbyAudience } from "@/domain/ports/togetherLobby.port";
import type { TogetherConnection } from "@/ui/presenters/TogetherConnectionChoice";

export function workoutMeta(
  exerciseCount: number,
  minutes?: number | null,
): string {
  const exercises = `${exerciseCount} ${exerciseCount === 1 ? "exercise" : "exercises"}`;
  return minutes && minutes > 0
    ? `${exercises} · about ${minutes} min`
    : exercises;
}

/** Canvas row 1c: Pick a workout → Start a shared session; mode and audience asked once, preset from settings. */
export function TogetherStartContainer() {
  const { storage, togetherLobby: lobby, togetherCloud: cloud } = useAdapters();
  const { session: auth } = useAuth();
  const userId = auth?.userId;
  const gate = useTogetherGate();
  const workouts = useWorkouts();
  const home = useGetHome();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ workoutId?: string }>();
  const settings = useTogetherSettings();
  const [selected, setSelected] = useState<string | null>(
    params.workoutId ?? null,
  );
  const [step, setStep] = useState<"pick" | "setup">(
    params.workoutId ? "setup" : "pick",
  );
  const [audience, setAudience] = useState<TogetherLobbyAudience>(
    settings.audience,
  );
  const [connection, setConnection] = useState<TogetherConnection>(
    settings.connection,
  );
  const [error, setError] = useState("");
  const locked = useRef(false);
  const owner = useRef(userId);
  owner.current = userId;
  useEffect(() => {
    if (userId && settings.userId !== userId) void settings.rehydrate(userId);
    // The store rehydrates once per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);
  // Presets follow the settings once they have loaded for this account.
  useEffect(() => {
    if (settings.userId !== userId) return;
    setAudience(settings.audience);
    setConnection(settings.connection);
  }, [settings.userId, settings.audience, settings.connection, userId]);
  useEffect(() => {
    setSelected(params.workoutId ?? null);
    setStep(params.workoutId ? "setup" : "pick");
    setError("");
  }, [userId, params.workoutId]);
  const choices = useMemo(
    () => [
      ...new Map(
        [
          ...workouts.mine.workouts,
          ...workouts.assigned.workouts,
          ...workouts.default.workouts,
        ]
          .filter((w) => w.variationKind !== "loadout")
          .map((w) => [w.id, w]),
      ).values(),
    ],
    [
      workouts.mine.workouts,
      workouts.assigned.workouts,
      workouts.default.workouts,
    ],
  );
  const todayIds = useMemo(
    () => new Set((home.data?.todaysTraining ?? []).map((t) => t.workoutId)),
    [home.data?.todaysTraining],
  );
  const option = (w: (typeof choices)[number]): TogetherWorkoutOption => ({
    id: w.id,
    name: w.name,
    meta: workoutMeta(w.exercises.length, w.estimatedDurationMinutes),
  });
  const today = choices.filter((w) => todayIds.has(w.id)).map(option);
  const others = choices.filter((w) => !todayIds.has(w.id)).map(option);
  const chosen = choices.find((w) => w.id === selected);
  const active = userId ? storage.getActiveSession(userId) : null;
  const continuing =
    !!active &&
    !active.together &&
    !active.withClient &&
    !active.retrospectiveCompletedAt;
  const start = () => {
    if (!userId || !gate.allowed || locked.current || (!chosen && !continuing))
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
  if (!gate.allowed) {
    const lockedOut = gate.state === "locked";
    return (
      <View
        flex={1}
        backgroundColor="$bg"
        paddingTop={insets.top}
        padding={20}
        gap={16}
      >
        <Card surface={0}>
          <View gap={12}>
            <Text color="$text2" fontFamily="$body">
              {lockedOut
                ? "Every athlete needs a qualifying paid subscription."
                : "Checking your Together access…"}
            </Text>
            <Btn onPress={lockedOut ? gate.onUpgrade : gate.retry}>
              {lockedOut ? "View subscriptions" : "Check access"}
            </Btn>
            <Btn variant="ghost" onPress={() => router.back()}>
              Back
            </Btn>
          </View>
        </Card>
      </View>
    );
  }
  const online = connection === "online";
  // An open solo workout is the workout: there is nothing to pick.
  if ((step === "setup" || continuing) && (chosen || continuing)) {
    const loggedSets =
      active?.exercises.reduce((n, e) => n + e.sets.length, 0) ?? 0;
    return (
      <TogetherStartSessionPresenter
        workoutName={continuing ? active!.name : chosen!.name}
        workoutMeta={
          continuing
            ? loggedSets
              ? `Your current workout · keeps your ${loggedSets} logged ${loggedSets === 1 ? "set" : "sets"}`
              : "Your current workout"
            : workoutMeta(
                chosen!.exercises.length,
                chosen!.estimatedDurationMinutes,
              )
        }
        onChangeWorkout={() => {
          if (continuing) router.back();
          else setStep("pick");
        }}
        connection={connection}
        onConnectionChange={(next) => {
          setConnection(next);
          if (next === "online" && audience === "open") setAudience("friends");
        }}
        onlineAvailable={!!cloud}
        audience={audience}
        onAudienceChange={(next) => {
          if (online && next === "open") return;
          setAudience(next);
        }}
        notice={error}
        onStart={start}
        onBack={() =>
          continuing || params.workoutId ? router.back() : setStep("pick")
        }
      />
    );
  }
  return (
    <TogetherPickWorkoutPresenter
      today={today}
      others={others}
      selectedId={selected}
      loading={workouts.isRefreshing}
      onSelect={(id) => {
        setSelected(id);
        setStep("setup");
      }}
      onCreate={() => router.push("/(app)/workouts/create" as never)}
      onBack={() => router.back()}
    />
  );
}
