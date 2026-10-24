import { togetherInvitationLink } from "@/adapters/together/invitationLink";
import { hostDetailsFrom } from "@/adapters/together/planDetails";
import { invitationPayload } from "@/application/together/invitation";
import { TogetherScannerPresenter } from "@/ui/presenters/TogetherScannerPresenter";
import { TogetherPreparingPresenter } from "@/ui/presenters/TogetherPreparingPresenter";
import { TogetherStartRow } from "@/ui/presenters/TogetherStartRow";
import {
  TogetherWorkoutRow,
  togetherMemberTone,
} from "@/ui/presenters/TogetherWorkoutRow";
import { TogetherCloudContainer } from "./TogetherCloudContainer";
import type { TogetherCloudPort } from "@/domain/ports/togetherCloud.port";
import {
  TogetherPartnerPresenter,
  togetherPartnerAccess,
} from "@/ui/presenters/TogetherPartnerPresenter";
import { TogetherInvitePresenter } from "@/ui/presenters/TogetherInvitePresenter";
import { TogetherStartSheet } from "@/ui/presenters/TogetherStartSheet";
import { TogetherJoinRequestBar } from "@/ui/presenters/TogetherJoinRequestBar";
import { useTogetherSettings } from "@/state/together-settings";
import { Alert, AppState, Linking, Share, Platform } from "react-native";
import { TogetherSharingPresenter } from "@/ui/presenters/TogetherSharingPresenter";
import type {
  TogetherPreviousRow,
  TogetherSharingConsent,
} from "@/domain/ports/togetherShared.port";
import type { TogetherWorkoutStatus } from "@/domain/ports/togetherWorkout.port";
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
import { TogetherInvitationQr } from "@/ui/presenters/TogetherInvitationQr";
import type {
  TogetherLobbyAudience,
  TogetherLobbyPort,
} from "@/domain/ports/togetherLobby.port";
import type { WorkoutSession } from "@/domain/models/session";
import { BottomSheet, Btn } from "@/ui/components/foundation";
import {
  TogetherLobbyPresenter,
  togetherErrorCopy,
  togetherWorkoutCopy,
  type TogetherLobbyScreen,
} from "@/ui/presenters/TogetherLobbyPresenter";
import { isDiagnosticsAllowed } from "@/diagnostics/allowed";
import { shareTogetherLog } from "@/diagnostics/together/togetherLog";

/** Staging and development only: the lobby can share the Together log. */
const shareDiagnostics = isDiagnosticsAllowed()
  ? () => void shareTogetherLog()
  : undefined;

/** Native failure codes that mean the radio or its permission is off (canvas 1b "Can't host nearby"). */
const RADIO_OFF =
  /permission|wifi|lan_unavailable|nearby_unavailable|discovery|advertising|listener/i;
/** "keeps your 4 logged sets" on the solo strip; "your sets stay yours" before any set. */
export function startRowDetail(workout: WorkoutSession | null | undefined) {
  // A session starts with an empty row per planned set; only completed rows are logged.
  const logged =
    workout?.exercises.reduce(
      (n, e) => n + e.sets.filter((s) => s.isCompleted).length,
      0,
    ) ?? 0;
  return logged
    ? `keeps your ${logged} logged ${logged === 1 ? "set" : "sets"}`
    : "your sets stay yours";
}
/** The strip's status line: who is here and whether it is in sync. */
export function liveStatus(
  members: number,
  sharing: TogetherWorkoutStatus["sharing"] | undefined,
): { status: string; tone: "live" | "warn" | "muted" } {
  if (sharing === "reconnecting" || sharing === "paused")
    return { status: togetherWorkoutCopy(sharing), tone: "warn" };
  if (sharing === "local-only")
    return { status: togetherWorkoutCopy(sharing), tone: "muted" };
  return members > 1
    ? { status: `In sync · ${members} training`, tone: "live" }
    : { status: `Waiting for people · ${members} of 4`, tone: "muted" };
}

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
  onDiscardWorkout,
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
  onDiscardWorkout?: () => void;
  onAdoptPlan?: (
    plan: import("@/domain/ports/togetherShared.port").TogetherSharedPlan,
    mode: "append" | "replace-empty",
  ) => void;
  /** `partnerView` is set while a partner's avatar is selected on the strip. */
  children?: (row: ReactNode, partnerView?: ReactNode) => ReactNode;
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
  const shared = lobby.shared;
  useEffect(
    () => shared?.subscribe(() => refreshWorkout((v) => v + 1)),
    [shared],
  );
  const sharedSnapshot = shared?.getSnapshot();
  const defaults = useTogetherSettings();
  const [audience, setAudience] = useState<TogetherLobbyAudience>(
    defaults.audience === "friends" ? "invite-only" : defaults.audience,
  );
  const browsingIntent = useRef(false);
  const [screen, setScreen] = useState<TogetherLobbyScreen>("start");
  const [visible, setVisible] = useState(false);
  /** Canvas row 1b: the one sheet opened by Start on the solo strip. */
  const [startOpen, setStartOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [startingWorkout, setStartingWorkout] = useState(false);
  const [startFailed, setStartFailed] = useState(false);
  const hostGeneration = useRef(0);
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [viewing, setViewing] = useState<string | null>(null);
  const [remote, setRemote] = useState(false);
  /** Set only by an online Start; a Browse-online entry leaves it null. */
  const [hostOnline, setHostOnline] = useState<"friends" | "private" | null>(
    null,
  );
  const [friendsSelected, setFriendsSelected] = useState(
    defaults.audience === "friends",
  );
  const [connection, setConnection] = useState<"local" | "online">(
    defaults.connection,
  );
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
    setStartOpen(false);
    setViewing(null);
    setRemote(false);
    setHostOnline(null);
    browsingIntent.current = false;
    return () => {
      lifetime.current++;
      hostLifetime.current++;
      // Adapter composition owns session lifetime; navigation only ends UI callbacks.
    };
  }, [accountId, lobby]);
  // Presets come from Together settings for this account; the sheet changes them per session only.
  useEffect(() => {
    if (defaults.userId !== accountId) {
      void defaults.rehydrate(accountId);
      return;
    }
    setConnection(defaults.connection);
    setFriendsSelected(defaults.audience === "friends");
    setAudience(
      defaults.audience === "friends" ? "invite-only" : defaults.audience,
    );
    // Rehydrate is the store's own one-shot per account.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [defaults.userId, defaults.connection, defaults.audience, accountId]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state === "background") {
        setStartOpen(false);
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
  /** Grants (or revokes) what one person in the session may see; previous values are published right after. */
  const grantConsent = (recipient: string, consent: TogetherSharingConsent) =>
    invoke(async () => {
      const consentGeneration = generation.current;
      const request = (consentRequests.current.get(recipient) ?? 0) + 1;
      consentRequests.current.set(recipient, request);
      const shared = lobby.shared!;
      const stillCurrent = () =>
        consentGeneration === generation.current &&
        lobby.shared === shared &&
        consentRequests.current.get(recipient) === request;
      await shared.setConsent(recipient, consent);
      if (!stillCurrent()) return;
      const current = getWorkout?.();
      if (consent.prev && current?.userId === accountId && getPrevious) {
        const grantVersion = shared
          .getSnapshot()
          .grants.find(
            (g) => g.ownerId === accountId && g.recipientId === recipient,
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
            (g) => g.ownerId === accountId && g.recipientId === recipient,
          );
        if (!grant?.consent.prev || grant.version !== grantVersion) return;
        await shared.publishPrevious(
          recipient,
          currentPreviousRows(fresh, rows),
          Date.parse(current.startedAt),
        );
      }
    });
  // The stored sharing defaults apply once to each person who joins (canvas row 4, PER-60).
  const defaultGranted = useRef(new Set<string>());
  useEffect(() => {
    if (snapshot.phase !== "hosting" && snapshot.phase !== "joined") {
      defaultGranted.current.clear();
      return;
    }
    // Only this account's stored settings count, once they have been read.
    if (
      !lobby.shared ||
      !accountId ||
      defaults.userId !== accountId ||
      !defaults.hydrated
    )
      return;
    const consent: TogetherSharingConsent = {
      numbers: defaults.sharing.numbers,
      prev: defaults.sharing.previous,
      logging: defaults.sharing.logging,
    };
    const grants = lobby.shared.getSnapshot().grants;
    for (const m of snapshot.members) {
      if (m.userId === accountId || defaultGranted.current.has(m.userId))
        continue;
      defaultGranted.current.add(m.userId);
      if (
        grants.some(
          (g) => g.ownerId === accountId && g.recipientId === m.userId,
        ) ||
        (!consent.numbers && !consent.prev && !consent.logging)
      )
        continue;
      grantConsent(m.userId, consent);
    }
    // grantConsent is recreated each render; the members list drives the effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    snapshot.phase,
    snapshot.members,
    accountId,
    lobby.shared,
    defaults.sharing,
    defaults.userId,
    defaults.hydrated,
  ]);
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
      // The plan and start time ride in the advert when a workout is open.
      await (draft
        ? lobby.host(workoutName, selectedAudience, hostDetailsFrom(draft))
        : lobby.host(workoutName, selectedAudience));
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
        await lobby.shared.publishOwnActivity();
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
      await lobby.shared.publishOwnActivity();
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
    // Open is nearby-only; Private and Training partners can start online.
    if (initialHostAudience !== "open" && initialHostConnection === "online") {
      consumedHostIntent.current = true;
      onConsumeHostIntent?.();
      if (cloud && getWorkout && !getWorkout()?.together) {
        setHostOnline(
          initialHostAudience === "friends" ? "friends" : "private",
        );
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
              const id = lobby.getSnapshot().sessionId;
              await lobby.shared!.close(mode);
              if (dialogGeneration !== generation.current) return;
              if (id && lobby.getSnapshot().sessionId === id)
                await lobby.cancel();
              if (dialogGeneration !== generation.current) return;
              dismiss();
              if (mode === "finish_all" && localSessionId)
                router.push({
                  pathname: "/(app)/session/rate",
                  params: { localSessionId },
                } as never);
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
        initialHost={hostOnline ?? undefined}
        accountId={accountId}
        workoutName={workoutName}
        getWorkout={getWorkout}
        onLocal={() => {
          setRemote(false);
          setHostOnline(null);
          setFriendsSelected(false);
        }}
        onRestorePersonal={onRestorePersonal}
        onDiscardWorkout={onDiscardWorkout}
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
  const live = liveStatus(snapshot.members.length, workoutStatus?.sharing);
  const requests =
    snapshot.role === "host" && snapshot.phase === "hosting"
      ? snapshot.pending.map((request) => (
          <TogetherJoinRequestBar
            key={request.peerId}
            name={sharedSnapshot?.profiles[request.userId] ?? "Someone"}
            onAdmit={() => invoke(() => lobby.approve(request.peerId))}
            onDeny={() => invoke(() => lobby.decline(request.peerId))}
          />
        ))
      : null;
  const strip =
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
        accountId={accountId}
        status={live.status}
        tone={live.tone}
        onSelect={(id) => setViewing(id === accountId ? null : id)}
        onInvite={
          snapshot.role === "host" && snapshot.invitation
            ? () => {
                setSettingsOpen(false);
                setVisible(true);
              }
            : undefined
        }
        onSettings={() => {
          setSettingsOpen(true);
          setVisible(true);
        }}
        endLabel={snapshot.role === "host" ? "End" : "Leave"}
        onEnd={() => {
          setSettingsOpen(true);
          setScreen("start");
          setVisible(true);
        }}
      />
    ) : snapshot.phase === "idle" && !workoutStatus ? (
      <TogetherStartRow
        detail={startRowDetail(getWorkout?.())}
        onStart={() => setStartOpen(true)}
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
          Open
        </Btn>
      </View>
    );
  const row = requests?.length ? (
    <>
      {strip}
      {requests}
    </>
  ) : (
    strip
  );
  const partnerView =
    viewing && sharedSnapshot && lobby.shared ? (
      <TogetherPartnerPresenter
        key={`${accountId}:${viewing}`}
        snapshot={sharedSnapshot}
        accountId={accountId}
        ownerId={viewing}
        exerciseNames={exerciseNames}
        tone={togetherMemberTone(snapshot.members, accountId, viewing)}
        editable={
          togetherPartnerAccess(sharedSnapshot, viewing, accountId).editable
        }
        onOperation={(operation, observedRevision) =>
          lobby.shared!.requestDelegatedSet(
            viewing,
            operation,
            observedRevision,
          )
        }
      />
    ) : undefined;
  const startFromSheet = () => {
    const selectedAudience: TogetherLobbyAudience = friendsSelected
      ? "friends"
      : audience;
    if (connection === "local" || selectedAudience === "open") {
      const scope = hostGeneration.current + 1;
      void startLocalWorkout(selectedAudience).then(() => {
        if (scope !== hostGeneration.current) return;
        if (lobby.getSnapshot().phase === "hosting") {
          setStartOpen(false);
          setSettingsOpen(false);
          setVisible(true);
        }
      });
      return;
    }
    setStartOpen(false);
    invoke(async () => {
      const scope = generation.current;
      if (!cloud || !getWorkout || getWorkout()?.together)
        throw new Error("workout-changed");
      await lobby.cancel();
      if (scope !== generation.current) return;
      setHostOnline(friendsSelected ? "friends" : "private");
      setRemote(true);
    });
  };
  const hostFailure =
    startOpen && snapshot.phase === "unavailable" ? snapshot.error : undefined;
  const wifiOff = !!hostFailure && RADIO_OFF.test(hostFailure);
  return (
    <>
      <TogetherStartSheet
        visible={startOpen && snapshot.phase !== "hosting"}
        onClose={() => {
          setStartOpen(false);
          if (snapshot.phase === "unavailable")
            void lobby.cancel().catch(() => {});
        }}
        connection={connection}
        onConnectionChange={(value) => {
          setConnection(value);
          if (value === "online" && !friendsSelected && audience === "open") {
            setFriendsSelected(true);
          }
        }}
        onlineAvailable={!!cloud && !!getWorkout}
        audience={friendsSelected ? "friends" : audience}
        onAudienceChange={(value) => {
          if (connection === "online" && value === "open") return;
          setFriendsSelected(value === "friends");
          if (value !== "friends") setAudience(value);
        }}
        wifiOff={wifiOff}
        onOpenSettings={() =>
          void Linking.openSettings().catch(() => undefined)
        }
        onRetry={() => {
          void lobby.cancel().catch(() => {});
          setNotice("");
        }}
        busy={startingWorkout}
        notice={
          hostFailure && !wifiOff
            ? togetherErrorCopy(hostFailure, snapshot.transport)
            : startOpen
              ? notice
              : undefined
        }
        onStart={startFromSheet}
      />
      {children ? (
        children(row, partnerView)
      ) : (
        <>
          {row}
          {partnerView}
        </>
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
              ? undefined
              : settingsOpen && snapshot.phase === "hosting"
                ? "Together settings"
                : snapshot.phase === "selected"
                  ? "Join this workout"
                  : screen === "join"
                    ? "Join a session"
                    : "Train together"
        }
        eyebrow={showInvitation ? undefined : "TRAIN TOGETHER"}
        height={showInvitation ? 55 : "tall"}
        contentPadding={showInvitation ? { top: 4, bottom: 28 } : undefined}
        footer={
          startingSession ? (
            <Btn full variant="outline" onPress={close}>
              Cancel · keep my workout
            </Btn>
          ) : undefined
        }
      >
        {startingSession ? (
          <TogetherPreparingPresenter />
        ) : showInvitation ? (
          <TogetherInvitePresenter
            qr={
              <TogetherInvitationQr
                value={togetherInvitationLink({
                  connection: "local",
                  invitation: snapshot.invitation!,
                  transport: snapshot.transport ?? "lan",
                })}
              />
            }
            connection="local"
            audience={snapshot.audience}
            code={snapshot.invitationCode}
            notice={notice || snapshot.error}
            pendingCount={snapshot.pending.length}
            onClose={dismiss}
            onShare={() =>
              invoke(async () => {
                const url = togetherInvitationLink({
                  connection: "local",
                  invitation: snapshot.invitation!,
                  transport: snapshot.transport ?? "lan",
                });
                await Share.share(
                  Platform.OS === "ios" ? { url } : { message: url },
                );
              })
            }
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
                  onConsent={grantConsent}
                  onClose={confirmClose}
                  onDiscard={onDiscardWorkout}
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
              accountId={accountId}
              athleteNames={{
                ...sharedSnapshot?.profiles,
                [accountId]: displayName ?? "You",
              }}
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
              onDiscard={onDiscardWorkout}
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
                          await lobby.shared.publishOwnActivity();
                          if (snapshot.role === "host")
                            await lobby.shared.publishPlan(plan);
                        }
                        setStartFailed(false);
                      })
                  : undefined
              }
              onAudienceChange={(value) => {
                setFriendsSelected(false);
                if (value === "open") setConnection("local");
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
                if (
                  connection === "local" ||
                  (!friendsSelected && audience === "open")
                ) {
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
                  setHostOnline(friendsSelected ? "friends" : "private");
                  setRemote(true);
                });
              }}
              onSelect={() =>
                invoke(() =>
                  lobby.selectInvite(invitationPayload(code, "local")),
                )
              }
              onJoin={() => {
                browsingIntent.current = false;
                invoke(() => lobby.join());
              }}
              onScan={scan}
              onCopy={() =>
                invoke(async () => {
                  await Clipboard.setStringAsync(
                    togetherInvitationLink({
                      connection: "local",
                      invitation: snapshot.invitation!,
                      transport: snapshot.transport ?? "lan",
                    }),
                  );
                })
              }
              onReconnect={() => invoke(() => lobby.reconnect())}
              onCancel={close}
              onApprove={(peerId) => invoke(() => lobby.approve(peerId))}
              onDecline={(peerId) => invoke(() => lobby.decline(peerId))}
              onShareDiagnostics={shareDiagnostics}
              qr={
                snapshot.invitation ? (
                  <View backgroundColor="white">
                    <TogetherInvitationQr
                      value={togetherInvitationLink({
                        connection: "local",
                        invitation: snapshot.invitation,
                        transport: snapshot.transport ?? "lan",
                      })}
                    />
                  </View>
                ) : undefined
              }
              scanner={
                scanning ? (
                  <TogetherScannerPresenter
                    onCancel={() => {
                      generation.current++;
                      setScanning(false);
                    }}
                    camera={
                      <CameraView
                        testID="together-qr-camera"
                        style={{ flex: 1, width: "100%" }}
                        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
                        onBarcodeScanned={({ data }) => {
                          if (scanned.current) return;
                          scanned.current = true;
                          setScanning(false);
                          setCode(data);
                          invoke(() =>
                            lobby.selectInvite(
                              invitationPayload(data, "local"),
                            ),
                          );
                        }}
                      />
                    }
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
