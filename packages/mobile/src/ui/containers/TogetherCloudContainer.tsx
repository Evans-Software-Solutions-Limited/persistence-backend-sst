import { togetherInvitationLink } from "@/adapters/together/invitationLink";
import { invitationPayload } from "@/application/together/invitation";
import { TogetherScannerPresenter } from "@/ui/presenters/TogetherScannerPresenter";
import { Alert, AppState, Share, Platform } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { TogetherInvitationQr } from "@/ui/presenters/TogetherInvitationQr";
import { TogetherInvitePresenter } from "@/ui/presenters/TogetherInvitePresenter";
import { TogetherWorkoutRow } from "@/ui/presenters/TogetherWorkoutRow";
import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { View, Text } from "@tamagui/core";
import { router } from "expo-router";
import * as Clipboard from "expo-clipboard";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import type {
  TogetherCloudPort,
  TogetherCloudState,
} from "@/domain/ports/togetherCloud.port";
import type { WorkoutSession } from "@/domain/models/session";
import type {
  TogetherSharedSnapshot,
  TogetherPreviousRow,
} from "@/domain/ports/togetherShared.port";
import { TogetherCloudPresenter } from "@/ui/presenters/TogetherCloudPresenter";
import { TogetherSharingPresenter } from "@/ui/presenters/TogetherSharingPresenter";
import { TogetherPartnerPresenter } from "@/ui/presenters/TogetherPartnerPresenter";
export function cloudSharedView(
  state: TogetherCloudState,
  accountId: string,
): TogetherSharedSnapshot {
  const s = state.snapshot;
  const visible = state.phase === "active" && s?.sharingActive;
  const grants: TogetherSharedSnapshot["grants"][number][] = [];
  for (const p of s?.participants ?? []) {
    if (p.userId === accountId) {
      for (const target of s?.participants ?? [])
        if (target.userId !== accountId)
          grants.push({
            ownerId: accountId,
            recipientId: target.userId,
            version: p.ownRevision,
            consent: {
              numbers:
                p.numbersConsent?.recipientIds.includes(target.userId) ?? false,
              prev:
                p.previousConsent?.recipientIds.includes(target.userId) ??
                false,
              logging: p.allowPartnerLogging,
            },
          });
    } else if (visible)
      grants.push({
        ownerId: p.userId,
        recipientId: accountId,
        version: p.ownRevision,
        consent: {
          numbers: p.numbersAvailable,
          prev: p.previousValuesAvailable,
          logging: p.allowPartnerLogging,
        },
      });
  }
  const previous: Record<string, TogetherPreviousRow[]> = {};
  if (visible)
    for (const [owner, cache] of Object.entries(state.previous)) {
      if (
        !s?.participants.find((p) => p.userId === owner)
          ?.previousValuesAvailable
      )
        continue;
      previous[owner] = cache.values.flatMap((row) =>
        typeof row.exerciseId === "string" &&
        typeof row.setNumber === "number" &&
        typeof row.reps === "number" &&
        typeof row.weightKg === "number" &&
        typeof row.recordedAt === "string"
          ? [
              {
                exerciseId: row.exerciseId,
                setNumber: row.setNumber,
                reps: row.reps,
                weightKg: row.weightKg,
                recordedAt: Date.parse(row.recordedAt),
              },
            ]
          : [],
      );
    }
  return {
    plan: s?.plan ?? null,
    planHash: null,
    profiles: Object.fromEntries(
      (s?.participants ?? []).map((p) => [
        p.userId,
        p.displayName ?? "Training partner",
      ]),
    ),
    athletePlans:
      visible && s
        ? Object.fromEntries(s.participants.map((p) => [p.userId, s.plan]))
        : {},
    progress: visible
      ? (s?.participants ?? [])
          .filter((p) => p.userId !== accountId)
          .map((p) => ({
            userId: p.userId,
            revision: p.ownRevision,
            exercises: p.progress ?? [],
          }))
      : [],
    grants,
    previous,
    closures:
      s && !s.sharingActive ? [{ userId: accountId, mode: "leave" }] : [],
    delegated: [],
    deliveries: [],
    athletes: visible
      ? (s?.participants ?? [])
          .filter(
            (p) => p.userId !== accountId && p.numbersAvailable && p.execution,
          )
          .map((p) => ({
            userId: p.userId,
            revision: p.ownRevision,
            restEndsAt: p.execution!.restEndsAt ?? null,
            exercises: Object.fromEntries(
              p.execution!.exercises.map((e) => [
                e.planExerciseId,
                {
                  exerciseId:
                    e.substituteExerciseId ??
                    s!.plan.exercises.find(
                      (ex) => ex.planExerciseId === e.planExerciseId,
                    )!.exerciseId,
                  skipped: e.skipped,
                  sets: e.sets,
                },
              ]),
            ),
          }))
      : [],
  };
}
export function TogetherCloudContainer(p: {
  cloud: TogetherCloudPort;
  initialHostFriends?: boolean;
  accountId: string;
  workoutName: string;
  getWorkout: () => WorkoutSession | null;
  onLocal(): void;
  onRestorePersonal?(draft: WorkoutSession): void;
  onDiscardWorkout?(): void;
  children?: (row: ReactNode) => ReactNode;
}) {
  const rawState = useSyncExternalStore(
    (l) => p.cloud.subscribe(l),
    () => p.cloud.getSnapshot(),
  );
  const state: TogetherCloudState =
    rawState.snapshot &&
    !rawState.snapshot.participants.some((x) => x.userId === p.accountId)
      ? {
          phase: "unavailable",
          requests: [],
          previous: {},
          pendingCount: 0,
          error: "Account changed. Reopen Together for your own workout.",
        }
      : rawState;
  const [visible, setVisible] = useState(false),
    [code, setCode] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [viewing, setViewing] = useState<string | null>(null);
  const [, requestCameraPermission] = useCameraPermissions();
  const [scanning, setScanning] = useState(false);
  const scanned = useRef(false);
  const scanGeneration = useRef(0);
  const [inviteView, setInviteView] = useState(false);
  const [invitation, setInvitation] = useState<{
    tokenId: string;
    token: string;
    expiresAt: string;
    members: string;
  } | null>(null);
  const [friends, setFriends] = useState<
    { sessionId: string; hostName: string; occupancy: number }[]
  >([]);
  const generation = useRef(0),
    locked = useRef(false);
  useEffect(() => {
    const lifetime = generation;
    generation.current++;
    locked.current = false;
    setBusy(false);
    setNotice("");
    setCode("");
    setFriends([]);
    setInvitation(null);
    setInviteView(false);
    setScanning(false);
    setViewing(null);
    return () => {
      lifetime.current++;
    };
  }, [p.accountId, p.cloud]);
  const identity = useRef({ accountId: p.accountId, cloud: p.cloud });
  identity.current = { accountId: p.accountId, cloud: p.cloud };
  const isCurrent = () =>
    identity.current.accountId === p.accountId &&
    identity.current.cloud === p.cloud;
  const personalDraft = () => {
    const draft = p.getWorkout();
    if (
      !isCurrent() ||
      !draft ||
      draft.userId !== p.accountId ||
      draft.together
    )
      throw new Error("workout-changed");
    return draft;
  };
  const run = (action: () => Promise<unknown>) => {
    if (!isCurrent() || locked.current) return;
    const scope = generation.current;
    locked.current = true;
    setBusy(true);
    setNotice("");
    void Promise.resolve()
      .then(() => (scope === generation.current ? action() : undefined))
      .catch(() => {
        if (scope === generation.current)
          setNotice(
            "Could not complete this action. Your personal workout is kept on this device.",
          );
      })
      .finally(() => {
        if (scope === generation.current) {
          locked.current = false;
          setBusy(false);
        }
      });
  };
  const invitationMembers = (snapshot: TogetherCloudState["snapshot"]) =>
    (snapshot?.participants.map((member) => member.userId).sort() ?? []).join(
      ",",
    );
  const currentMembers = invitationMembers(state.snapshot);
  useEffect(() => {
    if (!invitation) return;
    if (invitation.members !== currentMembers) {
      setInvitation(null);
      return;
    }
    const remaining = Date.parse(invitation.expiresAt) - Date.now();
    const timer = setTimeout(() => setInvitation(null), Math.max(0, remaining));
    return () => clearTimeout(timer);
  }, [invitation, currentMembers]);
  const installInvitation = (
    result: Awaited<ReturnType<TogetherCloudPort["invite"]>>,
  ) => {
    if (
      !Number.isFinite(Date.parse(result.expiresAt)) ||
      Date.parse(result.expiresAt) <= Date.now()
    )
      throw new Error("invitation-expired");
    setInvitation({
      ...result,
      members: invitationMembers(p.cloud.getSnapshot().snapshot),
    });
  };
  const liveInvitation = () => {
    if (
      !invitation ||
      Date.parse(invitation.expiresAt) <= Date.now() ||
      invitation.members !== invitationMembers(p.cloud.getSnapshot().snapshot)
    ) {
      setInvitation(null);
      throw new Error("invitation-expired");
    }
    return togetherInvitationLink({
      connection: "online",
      invitation: invitation.token,
    });
  };
  const prepareInvitation = async () => {
    const scope = generation.current;
    const hosted = p.cloud.getSnapshot();
    if (hosted.phase !== "active" || hosted.snapshot?.hostId !== p.accountId)
      return;
    setInviteView(true);
    const result = await p.cloud.invite();
    if (scope !== generation.current || !isCurrent()) return;
    const current = p.cloud.getSnapshot();
    if (
      current.phase !== "active" ||
      current.snapshot?.sessionId !== hosted.snapshot.sessionId
    )
      return;
    installInvitation(result);
  };
  const initialHostConsumed = useRef(false);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (status) => {
      if (status === "background") {
        initialHostConsumed.current = true;
        generation.current++;
        locked.current = false;
        setBusy(false);
        setScanning(false);
      }
    });
    return () => listener.remove();
  }, []);
  useEffect(() => {
    if (!p.initialHostFriends || initialHostConsumed.current) return;
    initialHostConsumed.current = true;
    setVisible(true);
    // A recovered Together checkpoint keeps its existing authority.
    if (p.getWorkout()?.together) return;
    run(async () => {
      const scope = generation.current;
      await p.cloud.hostWorkout(personalDraft());
      if (scope !== generation.current || !isCurrent()) return;
      const hosted = p.cloud.getSnapshot();
      if (
        hosted.phase !== "active" ||
        hosted.snapshot?.hostId !== p.accountId
      ) {
        setNotice(
          "Your session has not been confirmed. Retry to recover it before making it visible to training partners.",
        );
        return;
      }
      try {
        await p.cloud.visibility(
          "friends",
          new Date(Date.now() + 15 * 60_000).toISOString(),
        );
      } catch {
        if (scope === generation.current)
          setNotice(
            "Your session was created, but visibility to training partners is not confirmed. Retry or use Show to training partners. Your workout is safe.",
          );
      }
      if (scope === generation.current && isCurrent())
        await prepareInvitation();
    });
    // Consume an explicit account-bound detail-page action once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.initialHostFriends]);
  const current = p.getWorkout();
  const resumeId =
    current?.userId === p.accountId && current.together?.transport === "cloud"
      ? current.together.sessionId
      : undefined;
  const attachedId = state.snapshot?.sessionId;
  useEffect(() => {
    if (!resumeId || attachedId) return;
    let alive = true;
    void p.cloud.retry().catch(() => {
      if (alive)
        setNotice(
          "Could not reconnect. Your personal workout remains on this device.",
        );
    });
    return () => {
      alive = false;
    };
  }, [resumeId, attachedId, p.cloud]);
  const shared = cloudSharedView(state, p.accountId);
  const own = state.snapshot?.participants.find(
    (x) => x.userId === p.accountId,
  );
  const names = Object.fromEntries(
    (state.snapshot?.participants ?? []).flatMap((x) =>
      Object.entries(x.exerciseCatalog).map(([id, value]) => [id, value.name]),
    ),
  );
  const review = (mode?: string) => {
    setVisible(false);
    router.push({
      pathname: "/(app)/session/rate",
      params: { localSessionId: current?.id, mode },
    } as never);
  };
  const row = state.snapshot ? (
    <TogetherWorkoutRow
      members={state.snapshot.participants.map((x, i) => ({
        userId: x.userId,
        name:
          x.userId === p.accountId
            ? "Me"
            : (x.displayName ?? `Athlete ${i + 1}`),
      }))}
      selectedId={viewing ?? p.accountId}
      status={state.phase === "active" ? "Connected" : state.phase}
      onSelect={(id) => {
        setViewing(id === p.accountId ? null : id);
        if (
          state.snapshot?.participants.find((x) => x.userId === id)
            ?.previousValuesAvailable
        )
          run(() => p.cloud.previous(id));
      }}
      onSettings={() => setVisible(true)}
      onEnd={() => setVisible(true)}
    />
  ) : (
    <View
      minHeight={44}
      paddingHorizontal={16}
      flexDirection="row"
      alignItems="center"
    >
      <Text flex={1} color="$text2">
        Remote Together
      </Text>
      <Btn size="sm" variant="soft" onPress={() => setVisible(true)}>
        Open
      </Btn>
    </View>
  );
  return (
    <>
      {viewing ? (
        <TogetherPartnerPresenter
          togetherRow={row}
          key={viewing}
          snapshot={shared}
          ownerId={viewing}
          accountId={p.accountId}
          exerciseNames={names}
          onMine={() => setViewing(null)}
          onOperation={async (operation, observedRevision) => {
            const owner = state.snapshot?.participants.find(
              (x) => x.userId === viewing,
            );
            if (
              !isCurrent() ||
              !owner ||
              !owner.numbersAvailable ||
              !owner.allowPartnerLogging
            )
              throw new Error("permission-changed");
            await p.cloud.command({
              target: { kind: "execution", athleteId: viewing },
              expectedVersion: observedRevision,
              delegationGeneration: owner.delegationGeneration,
              operation,
            });
          }}
        />
      ) : (
        (p.children?.(row) ?? row)
      )}
      <BottomSheet
        visible={visible}
        onClose={() => {
          generation.current++;
          locked.current = false;
          setBusy(false);
          setVisible(false);
          setScanning(false);
        }}
        title={
          inviteView && state.phase === "active" && invitation
            ? "Session is live"
            : "Train together"
        }
        eyebrow="TRAIN TOGETHER"
        height="tall"
        footer={
          inviteView ? (
            <Btn
              full
              variant="soft"
              onPress={() => {
                generation.current++;
                locked.current = false;
                setBusy(false);
                setVisible(false);
              }}
            >
              Back to my workout
            </Btn>
          ) : undefined
        }
      >
        {inviteView &&
        state.phase === "active" &&
        state.snapshot?.hostId === p.accountId ? (
          invitation ? (
            <TogetherInvitePresenter
              qr={
                <View backgroundColor="white">
                  <TogetherInvitationQr
                    value={togetherInvitationLink({
                      connection: "online",
                      invitation: invitation.token,
                    })}
                  />
                </View>
              }
              notice={notice}
              scanInstruction="Scan from Online join, or copy and send the invitation."
              pendingCount={state.requests.length}
              personal={false}
              onCopy={() =>
                run(() => Clipboard.setStringAsync(liveInvitation()))
              }
              onShare={() =>
                run(() =>
                  Share.share(
                    Platform.OS === "ios"
                      ? { url: liveInvitation() }
                      : { message: liveInvitation() },
                  ),
                )
              }
              onSettings={() => setInviteView(false)}
            />
          ) : (
            <View gap={16}>
              <Text fontFamily="$body" color="$text2">
                {busy
                  ? "Preparing your invitation…"
                  : "Your session is active, but its invitation is not ready."}
              </Text>
              {!!notice && (
                <Text fontFamily="$body" color="$text2">
                  {notice}
                </Text>
              )}
              <Btn full disabled={busy} onPress={() => run(prepareInvitation)}>
                Generate new invitation
              </Btn>
              <Btn full variant="outline" onPress={() => setInviteView(false)}>
                Session settings
              </Btn>
            </View>
          )
        ) : (
          <>
            {state.canDetachDraft && p.onRestorePersonal && (
              <Btn
                full
                variant="outline"
                onPress={() =>
                  run(async () => {
                    p.cloud.detachDraft(p.accountId, p.onRestorePersonal!);
                    p.onLocal();
                  })
                }
              >
                Continue personally
              </Btn>
            )}
            {!state.snapshot && (
              <>
                <Btn
                  full
                  variant="outline"
                  disabled={busy}
                  onPress={() =>
                    run(async () => {
                      const scope = generation.current;
                      const permission = await requestCameraPermission();
                      if (scope !== generation.current || !isCurrent()) return;
                      if (!permission.granted) {
                        setNotice(
                          "Camera permission is needed to scan. You can paste the online invitation instead.",
                        );
                        return;
                      }
                      scanned.current = false;
                      scanGeneration.current = scope;
                      setScanning(true);
                    })
                  }
                >
                  Scan online invitation
                </Btn>
                {scanning && (
                  <TogetherScannerPresenter
                    onCancel={() => {
                      generation.current++;
                      setScanning(false);
                    }}
                    camera={
                      <CameraView
                        testID="together-online-qr-camera"
                        style={{ flex: 1, width: "100%" }}
                        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                        onBarcodeScanned={({ data }) => {
                          if (
                            scanned.current ||
                            scanGeneration.current !== generation.current ||
                            !isCurrent()
                          )
                            return;
                          scanned.current = true;
                          setScanning(false);
                          try {
                            setCode(invitationPayload(data, "online"));
                          } catch {
                            setNotice(
                              "This is not a valid online invitation. Try another QR or paste the link.",
                            );
                            return;
                          }
                          setNotice(
                            "Online invitation scanned. Choose Join to request admission.",
                          );
                        }}
                      />
                    }
                  />
                )}
              </>
            )}
            <TogetherCloudPresenter
              state={state}
              accountId={p.accountId}
              workoutName={p.workoutName}
              code={code}
              onCode={setCode}
              busy={busy}
              notice={notice}
              invitation={invitation?.token}
              friends={friends}
              onHost={() =>
                run(async () => {
                  const fresh = p.getWorkout();
                  if (!fresh || fresh.userId !== p.accountId || fresh.together)
                    throw new Error("workout-changed");
                  const scope = generation.current;
                  setScanning(false);
                  await p.cloud.hostWorkout(fresh);
                  if (scope === generation.current && isCurrent())
                    await prepareInvitation();
                })
              }
              onJoin={() =>
                run(() => {
                  setScanning(false);
                  return p.cloud.join(
                    { inviteToken: invitationPayload(code, "online") },
                    personalDraft(),
                  );
                })
              }
              onFriends={() =>
                run(async () => {
                  const scope = generation.current;
                  const result = await p.cloud.friends();
                  if (!result.ok) throw new Error(result.error.message);
                  if (scope === generation.current)
                    setFriends(
                      result.value.data.map((f) => ({
                        sessionId: f.sessionId,
                        hostName: f.host.displayName ?? "Training partner",
                        occupancy: f.occupancy,
                      })),
                    );
                })
              }
              onSelectFriend={(id) =>
                run(() => p.cloud.join({ sessionId: id }, personalDraft()))
              }
              onInvite={() =>
                run(async () => {
                  const scope = generation.current;
                  const result = await p.cloud.invite();
                  if (scope !== generation.current) return;
                  installInvitation(result);
                  await Clipboard.setStringAsync(
                    togetherInvitationLink({
                      connection: "online",
                      invitation: result.token,
                    }),
                  );
                })
              }
              onRevoke={() =>
                run(async () => {
                  if (invitation)
                    await p.cloud.revokeInvite(invitation.tokenId);
                  setInvitation(null);
                })
              }
              onDecision={(id, approved) =>
                run(() => p.cloud.decide(id, approved ? "approve" : "reject"))
              }
              onRetry={() => run(() => p.cloud.retry())}
              onReview={() => review()}
              onCancel={() => {
                setScanning(false);
                generation.current++;
                locked.current = false;
                setBusy(false);
                if (state.phase === "pending-approval") {
                  run(async () => {
                    const cancelScope = generation.current;
                    await p.cloud.cancelJoin();
                    if (cancelScope === generation.current) setVisible(false);
                  });
                  return;
                }
                p.cloud.cancel();
                setVisible(false);
              }}
              onLocal={() => {
                setScanning(false);
                p.cloud.cancel();
                p.onLocal();
              }}
              onPartners={() => {
                setScanning(false);
                generation.current++;
                locked.current = false;
                setBusy(false);
                setVisible(false);
                router.push("/(app)/together/partners" as never);
              }}
              onVisible={() =>
                run(() =>
                  p.cloud.visibility(
                    "friends",
                    new Date(Date.now() + 15 * 60_000).toISOString(),
                  ),
                )
              }
            />
            {state.snapshot && own && (
              <TogetherSharingPresenter
                snapshot={shared}
                accountId={p.accountId}
                members={state.snapshot.participants.map((x) => ({
                  userId: x.userId,
                  host: x.userId === state.snapshot!.hostId,
                }))}
                role={state.snapshot.hostId === p.accountId ? "host" : "guest"}
                onRemove={(id) => {
                  const dialogGeneration = generation.current;
                  Alert.alert(
                    "Remove athlete?",
                    "They keep their own workout. Other athletes can continue this session.",
                    [
                      { text: "Keep training", style: "cancel" },
                      {
                        text: "Remove",
                        style: "destructive",
                        onPress: () => {
                          if (dialogGeneration === generation.current)
                            run(() => p.cloud.remove(id));
                        },
                      },
                    ],
                  );
                }}
                sessionLogging={own.allowPartnerLogging}
                onSessionLogging={(allowed) =>
                  run(() => p.cloud.delegation(allowed))
                }
                onConsent={(id, consent) =>
                  run(async () => {
                    const consentScope = generation.current;
                    const next = (ids: string[] | undefined, on: boolean) =>
                      on
                        ? [...new Set([...(ids ?? []), id])]
                        : (ids ?? []).filter((x) => x !== id);
                    if (
                      consent.numbers !==
                      (own.numbersConsent?.recipientIds.includes(id) ?? false)
                    )
                      await p.cloud.numbersConsent(
                        next(own.numbersConsent?.recipientIds, consent.numbers),
                      );
                    if (consentScope !== generation.current) return;
                    if (
                      consent.prev !==
                      (own.previousConsent?.recipientIds.includes(id) ?? false)
                    )
                      await p.cloud.previousConsent(
                        next(own.previousConsent?.recipientIds, consent.prev),
                      );
                    if (consentScope !== generation.current) return;
                    if (consent.logging !== own.allowPartnerLogging)
                      await p.cloud.delegation(consent.logging);
                  })
                }
                onDiscard={p.onDiscardWorkout}
                onClose={(mode) => {
                  if (mode === "finish_all") {
                    review(mode);
                    return;
                  }
                  Alert.alert(
                    "Stop sharing?",
                    "Your workout stays active. Nothing is rated or saved.",
                    [
                      { text: "Keep sharing", style: "cancel" },
                      {
                        text: "Stop sharing",
                        onPress: () =>
                          run(async () => {
                            if (!p.cloud.stopSharing)
                              throw new Error("stop-sharing-unavailable");
                            await p.cloud.stopSharing();
                            if (isCurrent()) setVisible(false);
                          }),
                      },
                    ],
                  );
                }}
              />
            )}
          </>
        )}
      </BottomSheet>
    </>
  );
}
