import { TogetherPreparingPresenter } from "@/ui/presenters/TogetherPreparingPresenter";
import { TogetherStartRow } from "@/ui/presenters/TogetherStartRow";
import { TogetherWorkoutRow } from "@/ui/presenters/TogetherWorkoutRow";
import { TogetherCloudContainer } from "./TogetherCloudContainer";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import { TogetherPartnerPresenter } from "@/ui/presenters/TogetherPartnerPresenter";
import { TogetherInvitePresenter } from "@/ui/presenters/TogetherInvitePresenter";
import { Alert, AppState, Share } from "react-native";
import { TogetherSharingPresenter } from "@/ui/presenters/TogetherSharingPresenter";
import type { TogetherPreviousRow } from "@/domain/ports/togetherShared.port";
import { router } from "expo-router";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View, Text } from "@tamagui/core";
import { CameraView, useCameraPermissions } from "expo-camera";
import * as Clipboard from "expo-clipboard";
import QRCode from "react-native-qrcode-svg";
import type {
  TogetherLobbyAudience,
  TogetherLobbyPort,
} from "@/domain/ports/togetherLobby.port";
import type { WorkoutSession } from "@/domain/models/session";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import {
  TogetherLobbyPresenter,
  togetherWorkoutCopy,
  type TogetherLobbyScreen,
} from "@/ui/presenters/TogetherLobbyPresenter";

function currentPreviousRows(
  workout: WorkoutSession,
  rows: readonly TogetherPreviousRow[],
) {
  const exerciseIds = new Set(
    workout.exercises
      .filter((exercise) => !exercise.skipped)
      .map((exercise) => exercise.exerciseId),
  );
  return rows.filter((row) => exerciseIds.has(row.exerciseId));
}

/** Mounted only by the disabled-by-default capability. Signing keys stay in the adapter. */
export function TogetherLobbyContainer({
  lobby,
  cloud,
  workoutName,
  displayName,
  exerciseNames = {},
  accountId,
  localSessionId,
  getWorkout,
  getPrevious,
  refreshPrevious,
  onAdoptPlan,
  onRestorePersonal,
  children,
  initialHostAudience,
  allowNewSharing = true,
  initialHostConnection = "local",
  onConsumeHostIntent,
}: {
  initialHostAudience?: TogetherLobbyAudience;
  allowNewSharing?: boolean;
  initialHostConnection?: "local" | "online";
  onConsumeHostIntent?: () => void;
  lobby: TogetherLobbyPort;
  cloud?: TogetherCloudPort;
  workoutName: string;
  displayName?: string;
  exerciseNames?: Readonly<Record<string, string>>;
  accountId: string;
  localSessionId?: string;
  getWorkout?: () => WorkoutSession | null;
  getPrevious?: () => readonly TogetherPreviousRow[];
  refreshPrevious?: (
    isCurrent: () => boolean,
  ) => Promise<readonly TogetherPreviousRow[] | null>;
  onRestorePersonal?: (draft: WorkoutSession) => void;
  onAdoptPlan?: (
    plan: import("@/domain/ports/togetherShared.port").TogetherSharedPlan,
    mode: "append" | "replace-empty",
  ) => void;
  children?: (row: ReactNode) => ReactNode;
}) {
  const snapshot = useSyncExternalStore(
    (listener) => lobby.subscribe(listener),
    () => lobby.getSnapshot(),
  );
  const [, refreshWorkout] = useState(0);
  useEffect(
    () => lobby.workout?.subscribe(() => refreshWorkout((v) => v + 1)),
    [lobby, accountId],
  );
  const workoutStatus = localSessionId
    ? lobby.workout?.status(accountId, localSessionId)
    : null;
  const sharedSnapshot = lobby.shared?.getSnapshot();
  const [audience, setAudience] =
    useState<TogetherLobbyAudience>("invite-only");
  const browsingIntent = useRef(false);
  const [screen, setScreen] = useState<TogetherLobbyScreen>("start");
  const [visible, setVisible] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startingWorkout, setStartingWorkout] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const hostGeneration = useRef(0);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [hostFriends, setHostFriends] = useState(false);
  const [friendsSelected, setFriendsSelected] = useState(false);
  const [connection, setConnection] = useState<"local" | "online">("local");
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const generation = useRef(0);
  const scanned = useRef(false);
  const refreshPreviousRef = useRef(refreshPrevious);
  refreshPreviousRef.current = refreshPrevious;
  const consentRequests = useRef(new Map<string, number>());

  const consumedHostIntent = useRef(false);
  const hostIntentAccount = useRef(accountId);
  const dismiss = () => {
    hostGeneration.current++;
    setStartingWorkout(false);
    consumedHostIntent.current = true;
    if (initialHostAudience) onConsumeHostIntent?.();
    generation.current++;
    setVisible(false);
    setScanning(false);
    setCode("");
    setNotice("");
  };
  const close = () => {
    browsingIntent.current = false;
    dismiss();
    const closeGeneration = generation.current;
    void (async () => {
      try {
        if (
          lobby.shared &&
          (snapshot.phase === "hosting" || snapshot.phase === "joined")
        )
          await lobby.shared.close(
            snapshot.role === "host" ? "save_own" : "leave",
          );
      } finally {
        if (closeGeneration === generation.current) await lobby.cancel();
      }
    })().catch(() => {});
  };
  useEffect(() => {
    const lifetime = generation;
    const hostLifetime = hostGeneration;
    hostGeneration.current++;
    setStartingWorkout(false);
    setStartFailed(false);
    generation.current++;
    setVisible(false);
    setScanning(false);
    setCode("");
    setNotice("");
    setSettingsOpen(false);
    setAudience("invite-only");
    setViewing(null);
    setRemote(false);
    setHostFriends(false);
    setFriendsSelected(false);
    setConnection("local");
    browsingIntent.current = false;
    return () => {
      lifetime.current++;
      hostLifetime.current++;
      void lobby.cancel().catch(() => {});
    };
  }, [accountId, lobby]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        hostGeneration.current++;
        setStartingWorkout(false);
        consumedHostIntent.current = true;
        if (initialHostAudience) onConsumeHostIntent?.();
        browsingIntent.current = false;
        generation.current++;
        setVisible(false);
        setScanning(false);
        setCode("");
        setNotice("");
      }
    });
    return () => listener.remove();
  }, [initialHostAudience, onConsumeHostIntent]);
  useEffect(() => {
    if (
      (snapshot.phase === "hosting" || snapshot.phase === "joined") &&
      displayName
    ) {
      void lobby.shared?.publishProfile(displayName).catch(() => {});
    }
  }, [snapshot.phase, lobby, displayName, accountId]);
  useEffect(() => {
    if (viewing && !snapshot.members.some((m) => m.userId === viewing))
      setViewing(null);
  }, [snapshot.members, viewing]);
  // Camera never stays active after selecting or losing authorization.
  useEffect(() => {
    if (snapshot.phase !== "idle") {
      generation.current++;
      setScanning(false);
      setCode("");
    }
  }, [snapshot.phase]);
  useEffect(() => {
    if (snapshot.phase !== "hosting" && snapshot.phase !== "joined") return;
    let active = true;
    const lifetime = generation.current;
    void refreshPreviousRef
      .current?.(() => active && generation.current === lifetime)
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [snapshot.phase, accountId, localSessionId]);
  const invoke = (action: () => Promise<void>) => {
    const current = generation.current;
    setNotice("");
    void (async () => action())().catch((error: unknown) => {
      if (current === generation.current)
        setNotice(
          error instanceof Error && error.message === "workout-unsupported"
            ? "This workout can’t be shared yet. Use a strength workout with weights and reps, without supersets, substitutions or RPE. You can keep logging personally."
            : "Could not complete this action. Your personal workout is safe.",
        );
    });
  };
  const startLocalWorkout = async (selectedAudience: TogetherLobbyAudience) => {
    const scope = ++hostGeneration.current;
    const draft = getWorkout?.();
    const promote = !!(lobby.workout && draft);
    setStartingWorkout(true);
    setStartFailed(false);
    setSettingsOpen(false);
    setNotice("");
    try {
      if (
        getWorkout &&
        (!draft ||
          draft.userId !== accountId ||
          draft.together ||
          (localSessionId && draft.id !== localSessionId))
      )
        throw new Error("workout-changed");
      await lobby.host(workoutName, selectedAudience);
      if (scope !== hostGeneration.current) return;
      const hosted = lobby.getSnapshot();
      if (hosted.phase !== "hosting" || hosted.role !== "host") return;
      if (!promote) return;
      const fresh = getWorkout?.();
      if (
        !fresh ||
        fresh.userId !== accountId ||
        fresh.id !== draft!.id ||
        fresh.together
      )
        throw new Error("workout-changed");
      await lobby.workout!.promote(fresh);
      if (scope !== hostGeneration.current) return;
      const plan = lobby.workout!.getPlan(accountId, fresh.id);
      if (!plan || !lobby.shared) throw new Error("workout-plan-unavailable");
      if (plan && lobby.shared) {
        lobby.shared.setOwnPlan(plan);
        await lobby.shared.publishPlan(plan);
      }
    } catch (error) {
      if (scope === hostGeneration.current) {
        setStartFailed(true);
        setNotice(
          error instanceof Error && error.message === "workout-unsupported"
            ? "This workout can’t be shared yet. Use a strength workout with weights and reps, without supersets, substitutions or RPE. You can keep logging personally."
            : "Could not finish preparing Together. Your workout stays on this device. Open settings to retry sharing or review your result.",
        );
      }
    } finally {
      if (scope === hostGeneration.current) setStartingWorkout(false);
    }
  };
  const retryHostedPlan = async () => {
    const scope = ++hostGeneration.current;
    setStartingWorkout(true);
    setNotice("");
    try {
      const current = getWorkout?.();
      const host = lobby.getSnapshot();
      if (
        !current ||
        current.userId !== accountId ||
        current.id !== localSessionId ||
        host.phase !== "hosting" ||
        host.role !== "host" ||
        !lobby.workout?.status(accountId, current.id)
      )
        throw new Error("workout-changed");
      const plan = lobby.workout.getPlan(accountId, current.id);
      if (!plan || !lobby.shared) throw new Error("workout-plan-unavailable");
      lobby.shared.setOwnPlan(plan);
      await lobby.shared.publishPlan(plan);
      if (scope === hostGeneration.current) {
        setStartFailed(false);
        setSettingsOpen(false);
      }
    } catch {
      if (scope === hostGeneration.current)
        setNotice(
          "Could not finish sharing your workout. Retry when connected, or review your own result. Your workout stays on this device.",
        );
    } finally {
      if (scope === hostGeneration.current) setStartingWorkout(false);
    }
  };
  useEffect(() => {
    if (!allowNewSharing || !initialHostAudience || consumedHostIntent.current)
      return;
    if (hostIntentAccount.current !== accountId) {
      consumedHostIntent.current = true;
      onConsumeHostIntent?.();
      return;
    }
    if (
      initialHostAudience === "friends" &&
      initialHostConnection === "online"
    ) {
      consumedHostIntent.current = true;
      onConsumeHostIntent?.();
      if (cloud && getWorkout && !getWorkout()?.together) {
        setHostFriends(true);
        setRemote(true);
      }
      return;
    }
    setFriendsSelected(initialHostAudience === "friends");
    setAudience(initialHostAudience);
    setScreen("start");
    setVisible(true);
    if (snapshot.phase === "preparing") return;
    consumedHostIntent.current = true;
    onConsumeHostIntent?.();
    if (snapshot.phase === "idle" && !getWorkout?.()?.together)
      void startLocalWorkout(initialHostAudience);
    // An explicit detail-page action is consumed once, never retried by a render or failure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialHostAudience,
    initialHostConnection,
    snapshot.phase,
    accountId,
    allowNewSharing,
  ]);
  const confirmRemoval = (id: string) => {
    const dialogGeneration = generation.current;
    Alert.alert(
      "Remove athlete?",
      "They keep their own workout. They will no longer receive session updates.",
      [
        { text: "Keep training", style: "cancel" },
        {
          text: "Remove",
          style: "destructive",
          onPress: () => {
            if (dialogGeneration === generation.current)
              invoke(() => lobby.removeParticipant!(id));
          },
        },
      ],
    );
  };
  const confirmClose = (mode: "finish_all" | "save_own" | "leave") => {
    const dialogGeneration = generation.current;
    Alert.alert(
      "End sharing?",
      mode === "finish_all"
        ? "Everyone will be told this session has ended. Work saved only on another device remains available for that athlete to review; it is not automatically saved to their account."
        : "Your own workout stays available. Other athletes keep their own work.",
      [
        { text: "Keep training", style: "cancel" },
        {
          text: "End sharing",
          onPress: () => {
            if (dialogGeneration !== generation.current) return;
            invoke(async () => {
              await lobby.shared!.close(mode);
              if (dialogGeneration !== generation.current) return;
              if (localSessionId) {
                dismiss();
                router.push({
                  pathname: "/(app)/session/rate",
                  params: { localSessionId },
                } as never);
              }
            });
          },
        },
      ],
    );
  };
  const scan = () => {
    const current = generation.current;
    invoke(async () => {
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (current !== generation.current) return;
      if (!result.granted) {
        setNotice(
          "Camera permission is unavailable. Paste the invitation instead.",
        );
        return;
      }
      scanned.current = false;
      setScanning(true);
    });
  };
  if (
    cloud &&
    getWorkout &&
    (remote || getWorkout()?.together?.transport === "cloud")
  )
    return (
      <TogetherCloudContainer
        cloud={cloud}
        initialHostFriends={hostFriends}
        accountId={accountId}
        workoutName={workoutName}
        getWorkout={getWorkout}
        onLocal={() => {
          setRemote(false);
          setHostFriends(false);
          setFriendsSelected(false);
        }}
        onRestorePersonal={onRestorePersonal}
      >
        {children}
      </TogetherCloudContainer>
    );
  if (snapshot.phase === "disabled" || (!allowNewSharing && !workoutStatus))
    return children?.(null) ?? null;
  // A host start traverses idle cleanup, credential preparation and promotion.
  // Keep one cancellable screen until the complete start action settles.
  const startingSession =
    startingWorkout ||
    (!!initialHostAudience &&
      !consumedHostIntent.current &&
      visible &&
      (snapshot.phase === "idle" || snapshot.phase === "preparing") &&
      !(
        initialHostAudience === "friends" && initialHostConnection === "online"
      ));
  const showInvitation =
    snapshot.phase === "hosting" &&
    snapshot.role === "host" &&
    !!snapshot.invitation &&
    !settingsOpen &&
    !startingWorkout &&
    !startFailed;
  const row =
    workoutStatus && snapshot.members.length ? (
      <TogetherWorkoutRow
        members={snapshot.members.map((m, i) => ({
          userId: m.userId,
          name:
            m.userId === accountId
              ? (displayName ?? "Me")
              : (sharedSnapshot?.profiles[m.userId] ?? `Athlete ${i + 1}`),
        }))}
        selectedId={viewing ?? accountId}
        status={togetherWorkoutCopy(workoutStatus.sharing)}
        onSelect={(id) => setViewing(id === accountId ? null : id)}
        onSettings={() => {
          setSettingsOpen(true);
          setVisible(true);
        }}
        onEnd={() => {
          setSettingsOpen(true);
          setScreen("start");
          setVisible(true);
        }}
      />
    ) : snapshot.phase === "idle" && !workoutStatus ? (
      <TogetherStartRow
        detail="your sets stay yours"
        onStart={() => {
          setScreen("start");
          setVisible(true);
        }}
      />
    ) : (
      <View
        minHeight={44}
        flexDirection="row"
        alignItems="center"
        gap={8}
        paddingHorizontal={16}
        backgroundColor="$surface"
        testID="together-workout-row"
      >
        <Text flex={1} fontFamily="$body" fontSize={12} color="$text2">
          {workoutStatus
            ? `My workout · ${togetherWorkoutCopy(workoutStatus.sharing)}`
            : snapshot.phase === "idle"
              ? "Train together · your sets stay yours"
              : "Together · lobby"}
        </Text>
        <Btn
          size="sm"
          variant="soft"
          onPress={() => {
            setScreen("start");
            setVisible(true);
          }}
        >
          {" "}
          {snapshot.phase === "idle" && !workoutStatus ? "Start" : "Open"}{" "}
        </Btn>
      </View>
    );
  return (
    <>
      {viewing && sharedSnapshot && lobby.shared ? (
        <View flex={1}>
          {row}
          <TogetherPartnerPresenter
            key={`${accountId}:${viewing}`}
            snapshot={sharedSnapshot}
            accountId={accountId}
            ownerId={viewing}
            exerciseNames={exerciseNames}
            onMine={() => setViewing(null)}
            onOperation={(operation, observedRevision) =>
              lobby.shared!.requestDelegatedSet(
                viewing,
                operation,
                observedRevision,
              )
            }
          />
        </View>
      ) : children ? (
        children(row)
      ) : (
        row
      )}
      <BottomSheet
        visible={visible}
        onClose={() => {
          if (startingSession) {
            close();
            return;
          }
          dismiss();
          if (browsingIntent.current) {
            browsingIntent.current = false;
            void lobby.cancel().catch(() => {});
          }
        }}
        title={
          startingSession
            ? "Starting Together"
            : showInvitation
              ? "Session is live"
              : settingsOpen && snapshot.phase === "hosting"
                ? "Together settings"
                : snapshot.phase === "selected"
                  ? "Join this workout"
                  : screen === "join"
                    ? "Join a session"
                    : snapshot.phase === "idle" && !workoutStatus
                      ? "Who can join?"
                      : "Train together"
        }
        eyebrow="TRAIN TOGETHER"
        height="tall"
        footer={
          startingSession ? (
            <Btn full variant="outline" onPress={close}>
              Cancel · keep my workout
            </Btn>
          ) : showInvitation ? (
            <Btn full onPress={dismiss}>
              Back to my workout
            </Btn>
          ) : undefined
        }
      >
        {startingSession ? (
          <TogetherPreparingPresenter />
        ) : showInvitation ? (
          <TogetherInvitePresenter
            qr={
              <View padding={8} backgroundColor="white">
                <QRCode value={snapshot.invitation!} size={140} />
              </View>
            }
            notice={notice || snapshot.error}
            pendingCount={snapshot.pending.length}
            friendsOnly={snapshot.audience === "friends"}
            personal={!workoutStatus}
            onCopy={() =>
              invoke(async () => {
                await Clipboard.setStringAsync(snapshot.invitation!);
              })
            }
            onShare={() =>
              invoke(async () => {
                await Share.share({ message: snapshot.invitation! });
              })
            }
            onSettings={() => setSettingsOpen(true)}
          />
        ) : (
          <>
            {startFailed && workoutStatus && snapshot.phase === "hosting" && (
              <Btn
                full
                disabled={startingWorkout}
                onPress={() => void retryHostedPlan()}
              >
                Retry sharing my workout
              </Btn>
            )}
            {settingsOpen &&
              snapshot.phase === "hosting" &&
              snapshot.invitation && (
                <Btn full variant="soft" onPress={() => setSettingsOpen(false)}>
                  Show session invitation
                </Btn>
              )}
            {lobby.shared &&
              sharedSnapshot &&
              (snapshot.phase === "hosting" ||
                snapshot.phase === "joined" ||
                workoutStatus) && (
                <TogetherSharingPresenter
                  snapshot={sharedSnapshot}
                  accountId={accountId}
                  members={snapshot.members}
                  role={snapshot.role}
                  onRemove={
                    lobby.removeParticipant ? confirmRemoval : undefined
                  }
                  onConsent={(recipient, consent) =>
                    invoke(async () => {
                      const consentGeneration = generation.current;
                      const request =
                        (consentRequests.current.get(recipient) ?? 0) + 1;
                      consentRequests.current.set(recipient, request);
                      const shared = lobby.shared!;
                      const stillCurrent = () =>
                        consentGeneration === generation.current &&
                        lobby.shared === shared &&
                        consentRequests.current.get(recipient) === request;
                      await shared.setConsent(recipient, consent);
                      if (!stillCurrent()) return;
                      const current = getWorkout?.();
                      if (
                        consent.prev &&
                        current?.userId === accountId &&
                        getPrevious
                      ) {
                        const grantVersion = shared
                          .getSnapshot()
                          .grants.find(
                            (g) =>
                              g.ownerId === accountId &&
                              g.recipientId === recipient,
                          )?.version;
                        await shared.publishPrevious(
                          recipient,
                          currentPreviousRows(current, getPrevious()),
                          Date.parse(current.startedAt),
                        );
                        if (!stillCurrent() || !refreshPrevious) return;
                        const rows = await refreshPrevious(stillCurrent);
                        if (rows === null) return;
                        const fresh = getWorkout?.();
                        if (
                          !stillCurrent() ||
                          fresh?.id !== current.id ||
                          fresh.userId !== accountId ||
                          fresh.startedAt !== current.startedAt
                        )
                          return;
                        const grant = shared
                          .getSnapshot()
                          .grants.find(
                            (g) =>
                              g.ownerId === accountId &&
                              g.recipientId === recipient,
                          );
                        if (
                          !grant?.consent.prev ||
                          grant.version !== grantVersion
                        )
                          return;
                        await shared.publishPrevious(
                          recipient,
                          currentPreviousRows(fresh, rows),
                          Date.parse(current.startedAt),
                        );
                      }
                    })
                  }
                  onClose={confirmClose}
                />
              )}
            {snapshot.role === "guest" &&
              !workoutStatus &&
              sharedSnapshot?.plan &&
              onAdoptPlan && (
                <View gap={8}>
                  <Text color="$text" fontFamily="$display">
                    {sharedSnapshot.plan.name}
                  </Text>
                  <Text color="$text2">
                    Keep your own workout, or copy this plan before sharing.
                    Your logged sets are never replaced.
                  </Text>
                  <Btn
                    full
                    variant="outline"
                    onPress={() =>
                      invoke(async () =>
                        onAdoptPlan(sharedSnapshot.plan!, "append"),
                      )
                    }
                  >
                    Add their plan to mine
                  </Btn>
                  {!getWorkout?.()?.exercises.some(
                    (e) => e.sets.length > 0,
                  ) && (
                    <Btn
                      full
                      variant="outline"
                      onPress={() =>
                        invoke(async () =>
                          onAdoptPlan(sharedSnapshot.plan!, "replace-empty"),
                        )
                      }
                    >
                      Use this plan
                    </Btn>
                  )}
                </View>
              )}
            <Btn
              full
              variant="ghost"
              onPress={() => {
                dismiss();
                router.push("/(app)/together/partners" as never);
              }}
            >
              Training partners
            </Btn>
            <TogetherLobbyPresenter
              connectionOptions={
                snapshot.phase === "idle" &&
                !workoutStatus &&
                lobby.selectTransport && (
                  <View gap={8}>
                    <Text color="$text2" fontFamily="$body">
                      Connection
                    </Text>
                    {(lobby.transports ?? ["lan"]).map((transport) => (
                      <Btn
                        key={transport}
                        full
                        variant={
                          connection === "local" &&
                          (snapshot.transport ?? "lan") === transport
                            ? "soft"
                            : "outline"
                        }
                        onPress={() => {
                          setConnection("local");
                          invoke(async () => lobby.selectTransport!(transport));
                        }}
                      >
                        {transport === "nearby"
                          ? "Nearby phones"
                          : transport === "hotspot-owner"
                            ? "This Android phone’s hotspot"
                            : "Same Wi-Fi or hotspot"}
                      </Btn>
                    ))}
                    {friendsSelected && cloud && getWorkout && (
                      <Btn
                        full
                        variant={connection === "online" ? "soft" : "outline"}
                        onPress={() => setConnection("online")}
                      >
                        Online · internet required
                      </Btn>
                    )}
                    {screen === "join" && cloud && getWorkout && (
                      <Btn
                        full
                        variant="outline"
                        onPress={() =>
                          invoke(async () => {
                            const scope = generation.current;
                            await lobby.cancel();
                            if (scope !== generation.current) return;
                            setHostFriends(false);
                            setRemote(true);
                          })
                        }
                      >
                        Browse online sessions
                      </Btn>
                    )}
                    <Text color="$text2" fontSize={12}>
                      {connection === "online"
                        ? "Partners can discover this session online."
                        : friendsSelected
                          ? "Only verified training partners can join. Share the code or QR; internet is not required with valid offline access."
                          : "Nearby or directly connected phones only. Internet is not required once every athlete has valid offline access."}
                    </Text>
                  </View>
                )
              }
              snapshot={snapshot}
              screen={screen}
              code={code}
              notice={notice}
              workoutName={workoutName}
              trainingPartners={{
                selected: friendsSelected,
                onSelect: () => {
                  setFriendsSelected(true);
                  setConnection("local");
                },
              }}
              audience={audience}
              workoutStatus={workoutStatus}
              onReview={
                localSessionId
                  ? () => {
                      dismiss();
                      router.push({
                        pathname: "/(app)/session/together-review",
                        params: { localSessionId },
                      } as never);
                    }
                  : undefined
              }
              onPromote={
                lobby.workout && getWorkout
                  ? () =>
                      invoke(async () => {
                        const session = getWorkout();
                        if (
                          !session ||
                          session.id !== localSessionId ||
                          session.userId !== accountId
                        )
                          throw new Error("workout-changed");
                        const promotionGeneration = generation.current;
                        await lobby.workout!.promote(session);
                        if (promotionGeneration !== generation.current) return;
                        const plan = lobby.workout!.getPlan(
                          accountId,
                          session.id,
                        );
                        if (plan && lobby.shared) {
                          lobby.shared.setOwnPlan(plan);
                          if (snapshot.role === "host")
                            await lobby.shared.publishPlan(plan);
                        }
                        setStartFailed(false);
                      })
                  : undefined
              }
              onAudienceChange={(value) => {
                setFriendsSelected(false);
                setConnection("local");
                setAudience(value);
              }}
              onBrowse={() => {
                generation.current++;
                browsingIntent.current = true;
                setScanning(false);
                invoke(() => lobby.browse());
              }}
              onSelectDiscovered={(sessionId) =>
                invoke(() => lobby.selectDiscovered(sessionId))
              }
              onUseInvitation={() => {
                browsingIntent.current = false;
                setScreen("join");
                if (snapshot.phase !== "idle") invoke(() => lobby.cancel());
              }}
              onCodeChange={setCode}
              onHost={() => {
                if (!friendsSelected || connection === "local") {
                  void startLocalWorkout(
                    friendsSelected ? "friends" : audience,
                  );
                  return;
                }
                invoke(async () => {
                  const scope = generation.current;
                  if (!cloud || !getWorkout || getWorkout()?.together)
                    throw new Error("workout-changed");
                  await lobby.cancel();
                  if (scope !== generation.current) return;
                  setHostFriends(true);
                  setRemote(true);
                });
              }}
              onSelect={() => invoke(() => lobby.selectInvite(code))}
              onJoin={() => {
                browsingIntent.current = false;
                invoke(() => lobby.join());
              }}
              onScan={scan}
              onCopy={() =>
                invoke(async () => {
                  await Clipboard.setStringAsync(snapshot.invitation!);
                })
              }
              onReconnect={() => invoke(() => lobby.reconnect())}
              onCancel={close}
              onApprove={(peerId) => invoke(() => lobby.approve(peerId))}
              onDecline={(peerId) => invoke(() => lobby.decline(peerId))}
              qr={
                snapshot.invitation ? (
                  <View padding={12} backgroundColor="white">
                    <QRCode value={snapshot.invitation} size={180} />
                  </View>
                ) : undefined
              }
              scanner={
                scanning ? (
                  <CameraView
                    testID="together-qr-camera"
                    style={{ height: 220 }}
                    barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                    onBarcodeScanned={({ data }) => {
                      if (scanned.current) return;
                      scanned.current = true;
                      setScanning(false);
                      setCode(data);
                      invoke(() => lobby.selectInvite(data));
                    }}
                  />
                ) : undefined
              }
            />
          </>
        )}
      </BottomSheet>
    </>
  );
}
