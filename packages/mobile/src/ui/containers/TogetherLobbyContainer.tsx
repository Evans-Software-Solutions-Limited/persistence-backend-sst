import { TogetherWorkoutRow } from "@/ui/presenters/TogetherWorkoutRow";
import { TogetherCloudContainer } from "./TogetherCloudContainer";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import { TogetherPartnerPresenter } from "@/ui/presenters/TogetherPartnerPresenter";
import { Alert, AppState } from "react-native";
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
  onAdoptPlan,
  onRestorePersonal,
  children,
}: {
  lobby: TogetherLobbyPort;
  cloud?: TogetherCloudPort;
  workoutName: string;
  displayName?: string;
  exerciseNames?: Readonly<Record<string, string>>;
  accountId: string;
  localSessionId?: string;
  getWorkout?: () => WorkoutSession | null;
  getPrevious?: () => readonly TogetherPreviousRow[];
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
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const generation = useRef(0);
  const scanned = useRef(false);
  const dismiss = () => {
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
    generation.current++;
    setVisible(false);
    setScanning(false);
    setCode("");
    setNotice("");
    setAudience("invite-only");
    setViewing(null);
    setRemote(false);
    browsingIntent.current = false;
    return () => {
      lifetime.current++;
      void lobby.cancel().catch(() => {});
    };
  }, [accountId, lobby]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "active") {
        browsingIntent.current = false;
        generation.current++;
        setVisible(false);
        setScanning(false);
        setCode("");
        setNotice("");
      }
    });
    return () => listener.remove();
  }, []);
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
                  pathname: "/(app)/session/together-review",
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
        accountId={accountId}
        workoutName={workoutName}
        getWorkout={getWorkout}
        onLocal={() => setRemote(false)}
        onRestorePersonal={onRestorePersonal}
      >
        {children}
      </TogetherCloudContainer>
    );
  if (snapshot.phase === "disabled") return children?.(null) ?? null;
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
        onSettings={() => setVisible(true)}
        onEnd={() => {
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
        {snapshot.phase === "idle" && !workoutStatus && (
          <Btn
            size="sm"
            variant="ghost"
            onPress={() => {
              setScreen("join");
              setVisible(true);
            }}
          >
            Join
          </Btn>
        )}
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
          dismiss();
          if (browsingIntent.current) {
            browsingIntent.current = false;
            void lobby.cancel().catch(() => {});
          }
        }}
        title={
          snapshot.phase === "selected"
            ? "Join this workout"
            : screen === "join"
              ? "Join a session"
              : "Train together"
        }
        eyebrow="TRAIN TOGETHER"
        height="tall"
      >
        {snapshot.phase === "idle" &&
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
                    (snapshot.transport ?? "lan") === transport
                      ? "soft"
                      : "outline"
                  }
                  onPress={() =>
                    invoke(async () => lobby.selectTransport!(transport))
                  }
                >
                  {transport === "nearby"
                    ? "Nearby phones"
                    : transport === "hotspot-owner"
                      ? "This Android phone’s hotspot"
                      : "Same Wi-Fi or hotspot"}
                </Btn>
              ))}
              {cloud && getWorkout && (
                <Btn
                  full
                  variant="outline"
                  onPress={() =>
                    invoke(async () => {
                      const remoteGeneration = generation.current;
                      await lobby.cancel();
                      if (remoteGeneration === generation.current)
                        setRemote(true);
                    })
                  }
                >
                  Remote · training partners
                </Btn>
              )}
              <Text color="$text2" fontSize={12}>
                Nearby or directly connected phones only. Internet is not
                required once every athlete has valid offline access.
              </Text>
            </View>
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
              onRemove={lobby.removeParticipant ? confirmRemoval : undefined}
              onConsent={(recipient, consent) =>
                invoke(async () => {
                  const consentGeneration = generation.current;
                  await lobby.shared!.setConsent(recipient, consent);
                  if (consentGeneration !== generation.current) return;
                  const current = getWorkout?.();
                  if (
                    consent.prev &&
                    current?.userId === accountId &&
                    getPrevious
                  )
                    await lobby.shared!.publishPrevious(
                      recipient,
                      getPrevious(),
                      Date.parse(current.startedAt),
                    );
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
                Keep your own workout, or copy this plan before sharing. Your
                logged sets are never replaced.
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
              {!getWorkout?.()?.exercises.some((e) => e.sets.length > 0) && (
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
          snapshot={snapshot}
          screen={screen}
          code={code}
          notice={notice}
          workoutName={workoutName}
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
                    const plan = lobby.workout!.getPlan(accountId, session.id);
                    if (plan && lobby.shared) {
                      lobby.shared.setOwnPlan(plan);
                      if (snapshot.role === "host")
                        await lobby.shared.publishPlan(plan);
                    }
                  })
              : undefined
          }
          onAudienceChange={setAudience}
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
            invoke(() => lobby.cancel());
          }}
          onCodeChange={setCode}
          onHost={() => invoke(() => lobby.host(workoutName, audience))}
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
      </BottomSheet>
    </>
  );
}
