import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, Linking } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useTogetherGate } from "@/ui/hooks/useTogetherGate";
import {
  TogetherJoinPresenter,
  type TogetherJoinRow,
  type TogetherJoinSearch,
} from "@/ui/presenters/TogetherJoinPresenter";
import { TogetherJoinConsentPresenter } from "@/ui/presenters/TogetherJoinConsentPresenter";
import { TogetherJoiningPresenter } from "@/ui/presenters/TogetherJoiningPresenter";
import { TogetherScannerPresenter } from "@/ui/presenters/TogetherScannerPresenter";
import {
  togetherErrorCopy,
  togetherWorkoutCopy,
} from "@/ui/presenters/TogetherLobbyPresenter";
import { togetherCloudErrorCopy } from "@/ui/presenters/TogetherCloudPresenter";
import { Btn, Card } from "@/ui/components/foundation";
import { Text, View } from "@tamagui/core";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  readTogetherInvitation,
  invitationPayload,
} from "@/application/together/invitation";
import { startSessionCommand } from "@/application/commands/session";
import { adoptSharedPlan } from "@/adapters/together/adoptSharedPlan";
import { usePendingTogetherJoin } from "@/state/pending-together-join";
import {
  loadPartnerSessions,
  loadPartners,
  type PartnerOnlineSession,
} from "./TogetherHubContainer";
import type {
  TogetherLobbyPort,
  TogetherLobbySnapshot,
  TogetherPlanRow,
} from "@/domain/ports/togetherLobby.port";
import type {
  CloudPreview,
  TogetherCloudState,
} from "@/domain/ports/togetherCloud.port";
import { normaliseSessionCode } from "@/adapters/together/planDetails";
import { reportTogetherFailure } from "@/diagnostics/together/togetherReport";

const EMPTY: TogetherLobbySnapshot = {
  phase: "disabled",
  members: [],
  pending: [],
};
const CLOUD_EMPTY: TogetherCloudState = {
  phase: "idle",
  requests: [],
  previous: {},
  pendingCount: 0,
};
/** Native failure codes that mean the radio or its permission is off, not a bad session. */
const RADIO_OFF =
  /permission|wifi|lan_unavailable|nearby_unavailable|discovery|advertising|listener/i;
/** Selecting a row or code can fail on its own; the radio is fine and the list stays usable. */
const SELECTION_ERRORS = new Set([
  "discovery-expired",
  "host-unavailable",
  "own-invitation",
  "code-not-found",
  "session-left",
]);
export function togetherSearchFailure(code: string): string {
  return RADIO_OFF.test(code) && !SELECTION_ERRORS.has(code)
    ? "Wi-Fi is off. Turn it on in Settings. You don’t need to join a network."
    : togetherErrorCopy(code);
}

interface Partner {
  name: string;
  since?: string;
}
type Target =
  | {
      kind: "local";
      hostUserId: string;
      workoutName: string;
      memberCount?: number;
      startedAt?: number;
      plan?: readonly TogetherPlanRow[];
    }
  | {
      kind: "online-session";
      sessionId: string;
      hostUserId: string;
      occupancy: number;
      workoutName?: string;
      startedAt?: string;
      plan?: readonly TogetherPlanRow[];
    }
  /** A pasted Online link; the preview arrives while the consent card is up. */
  | { kind: "online-invite"; token: string; preview?: CloudPreview }
  /** A typed code no nearby host answered to, resolved by the backend (PER-60). */
  | { kind: "online-code"; code: string; preview: CloudPreview };

/** Copy for a typed code (PER-60). Nearby needs a search first, Online needs internet. */
const CODE_COPY: Record<string, string> = {
  "discovery-expired": "That session is no longer nearby. Search again.",
  "host-unavailable": "That session is no longer available. Search again.",
  "code-not-found":
    "Couldn’t find that code. Nearby sessions show after a search, Online ones need internet. Ask the host to show their QR.",
  "code-offline":
    "No internet to check that code. Nearby sessions show after a search; otherwise ask the host to show their QR.",
  "session-left": togetherErrorCopy("session-left"),
};

/** Canvas row 1: Join a session → Join this workout → Joining → the workout. */
export function TogetherJoinContainer() {
  const {
    storage,
    api,
    togetherLobby: lobby,
    togetherCloud: cloud,
  } = useAdapters();
  const { userId, session, rereadCache } = useActiveSession();
  const gate = useTogetherGate();
  const params = useLocalSearchParams<{
    connection?: string;
    invitation?: string;
    transport?: string;
    session?: string;
    scan?: string;
  }>();
  const insets = useSafeAreaInsets();
  const snapshot = useSyncExternalStore(
    (l) => lobby?.subscribe(l) ?? (() => {}),
    () => lobby?.getSnapshot() ?? EMPTY,
  );
  const remote = useSyncExternalStore(
    (l) => cloud?.subscribe(l) ?? (() => {}),
    () => cloud?.getSnapshot() ?? CLOUD_EMPTY,
  );
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searched, setSearched] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [partners, setPartners] = useState<Record<string, Partner>>({});
  const [online, setOnline] = useState<PartnerOnlineSession[]>([]);
  const [target, setTarget] = useState<Target | null>(null);
  const [joining, setJoining] = useState(false);
  /** Join was pressed for this Nearby target; the host's admission may land after a failed attempt. */
  const [asked, setAsked] = useState(false);
  const [cold, setCold] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scope = useRef({ userId, lobby, cloud });
  scope.current = { userId, lobby, cloud };
  const mounted = useRef(true),
    lock = useRef(false),
    generation = useRef(0),
    scanned = useRef(false),
    incoming = useRef(""),
    adopted = useRef(false),
    focused = useRef(false);
  const ownSharing = !!session?.together;
  const liveLobby = ["hosting", "joined", "reconnecting"].includes(
    snapshot.phase,
  );
  const blocked =
    ownSharing ||
    (liveLobby && snapshot.phase !== "joined") ||
    (!!remote.snapshot && remote.phase !== "pending-approval");
  useEffect(() => {
    mounted.current = true;
    const lifetime = generation;
    return () => {
      mounted.current = false;
      lifetime.current++;
    };
  }, []);
  useEffect(() => {
    generation.current++;
    lock.current = false;
    setBusy(false);
    setScanning(false);
    setCode("");
    setNotice("");
    setSearched(false);
    setTarget(null);
    setJoining(false);
    setAsked(false);
    adopted.current = false;
    setPartners({});
    setOnline([]);
    incoming.current = "";
  }, [userId, lobby, cloud]);
  useEffect(() => {
    const listener = AppState.addEventListener("change", (state) => {
      if (state !== "background") return;
      generation.current++;
      lock.current = false;
      setBusy(false);
      setScanning(false);
    });
    return () => listener.remove();
  }, []);
  // "Searching nearby · 0:08" — a wall clock from the start of the current search.
  const searching = snapshot.phase === "browsing" && !!snapshot.searching;
  useEffect(() => {
    if (!searching) return;
    setElapsed(0);
    const started = Date.now();
    const timer = setInterval(
      () => setElapsed(Math.floor((Date.now() - started) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [searching]);
  const current = (owner: typeof scope.current, version: number) => () =>
    mounted.current &&
    scope.current.userId === owner.userId &&
    scope.current.lobby === owner.lobby &&
    scope.current.cloud === owner.cloud &&
    version === generation.current;
  const run = (
    action: (isCurrent: () => boolean) => Promise<void>,
    failure = "Could not connect. Your own workout is safe. Check the invitation and try again.",
  ) => {
    if (!mounted.current || !userId || !gate.allowed || lock.current) return;
    const isCurrent = current(scope.current, generation.current);
    lock.current = true;
    setBusy(true);
    setNotice("");
    void Promise.resolve()
      .then(() => (isCurrent() ? action(isCurrent) : undefined))
      .catch((error: unknown) => {
        if (!isCurrent()) return;
        const code = error instanceof Error ? error.message : "";
        const specific =
          code === "workout-already-sharing"
            ? "You already have a live session. Your workout has been kept."
            : CODE_COPY[code] || togetherCloudErrorCopy(code);
        // A generic line hides the real code from everyone: send it to Sentry.
        if (!specific)
          reportTogetherFailure({
            mode:
              target && target.kind !== "local"
                ? "online"
                : (lobby?.getSnapshot().transport ?? "nearby"),
            stage: "join",
            code: code || "unknown",
            copy: "fallback",
          });
        setNotice(specific || failure);
        setJoining(false);
      })
      .finally(() => {
        if (isCurrent()) {
          lock.current = false;
          setBusy(false);
        }
      });
  };
  /** Partners by id, for names and the verified-partner row; a failure leaves names blank. */
  const loadPartnerNames = useCallback(() => {
    const social = api.togetherSocial;
    if (!social || !userId) return;
    const isCurrent = current(scope.current, generation.current);
    void loadPartners(social, userId)
      .then((list) => {
        if (isCurrent())
          setPartners(
            Object.fromEntries(list.map((p) => [p.userId, { name: p.name }])),
          );
      })
      .catch(() => {});
  }, [api.togetherSocial, userId]);
  const loadOnline = useCallback(() => {
    if (!cloud || !userId) return;
    const isCurrent = current(scope.current, generation.current);
    void loadPartnerSessions(cloud)
      .then((sessions) => {
        if (isCurrent()) setOnline(sessions);
      })
      .catch(() => {});
  }, [cloud, userId]);
  /** Searches nearby and refreshes partners' Online sessions; the controller stops the radio at 30 s. */
  const search = useCallback(
    (pull = false) => {
      if (!userId || !gate.allowed || blocked) return;
      setSearched(true);
      setNotice("");
      loadPartnerNames();
      loadOnline();
      if (!lobby) return;
      const isCurrent = current(scope.current, generation.current);
      if (pull) setRefreshing(true);
      void lobby
        .browse()
        .catch(() => {})
        .finally(() => {
          if (isCurrent() && pull) setRefreshing(false);
        });
    },
    [userId, gate.allowed, blocked, lobby, loadPartnerNames, loadOnline],
  );
  const searchRef = useRef(search);
  searchRef.current = search;
  useFocusEffect(
    useCallback(() => {
      focused.current = true;
      // Opening the screen is the search; nothing starts without it.
      if (
        !incoming.current &&
        !params.invitation &&
        !params.session &&
        lobby?.getSnapshot().phase !== "selected"
      )
        searchRef.current();
      return () => {
        focused.current = false;
        if (lobby?.getSnapshot().phase === "browsing")
          void lobby.cancel().catch(() => {});
      };
      // Focus owns the search; param-driven entries select instead.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [lobby, userId, gate.allowed]),
  );
  const select = async (text: string, isCurrent: () => boolean) => {
    if (blocked) throw new Error("workout-already-sharing");
    const typed = normaliseSessionCode(text);
    if (typed) {
      setCode(text);
      setScanning(false);
      // A nearby host advertises its code: no internet needed when the search found it.
      const nearby = async () => {
        await lobby!.selectCode!(typed);
        if (!isCurrent()) return;
        const selected = lobby!.getSnapshot();
        if (selected.phase === "selected" && selected.selection) {
          setCold(false);
          setTarget(localTarget(selected.selection));
          return;
        }
        if (selected.error) throw new Error(selected.error);
      };
      if (lobby?.selectCode && nearbyHasCode(lobby, typed)) return nearby();
      const preview = cloud ? await cloud.preview({ code: typed }) : undefined;
      if (!isCurrent()) return;
      if (preview?.ok) {
        setCold(false);
        setTarget({
          kind: "online-code",
          code: typed,
          preview: preview.value,
        });
        return;
      }
      // The search may still be verifying the host that owns this code: a
      // Nearby code is unknown to the server, so "not found" must wait for
      // the search to finish. Saying it earlier showed "Couldn’t find that
      // code" while the search was finding that very host (TestFlight 31 Oct).
      if (lobby?.selectCode && (await nearbyFinds(lobby, typed))) {
        if (!isCurrent()) return;
        return nearby();
      }
      if (!isCurrent()) return;
      throw new Error(
        preview && !preview.ok && preview.error.code === "network"
          ? "code-offline"
          : "code-not-found",
      );
    }
    const value = text.includes("://")
      ? readTogetherInvitation(text)
      : { connection: "local" as const, invitation: text };
    setCode(text);
    setScanning(false);
    if (value.connection === "online") {
      if (!cloud) throw new Error("online-unavailable");
      const token = value.invitation;
      setTarget({ kind: "online-invite", token });
      // The consent card fills in as the preview lands; a miss keeps the generic card.
      void cloud
        .preview({ inviteToken: invitationPayload(token, "online") })
        .then((result) => {
          if (!isCurrent() || !result.ok) return;
          setTarget((t) =>
            t?.kind === "online-invite" && t.token === token
              ? { ...t, preview: result.value }
              : t,
          );
        })
        .catch(() => {});
      return;
    }
    if (!lobby) throw new Error("local-unavailable");
    if (lobby.getSnapshot().phase !== "idle") await lobby.cancel();
    if (!isCurrent()) return;
    if ("transport" in value && value.transport && lobby.selectTransport)
      lobby.selectTransport(value.transport);
    await lobby.selectInvite(value.invitation);
    if (!isCurrent()) return;
    const selected = lobby.getSnapshot();
    if (selected.phase === "selected" && selected.selection)
      setTarget(localTarget(selected.selection));
    else if (selected.error) throw new Error(selected.error);
  };
  // Landing here with an account consumes the stashed link, whatever the gate
  // says: otherwise a gated user who leaves is sent straight back by AuthGate.
  useEffect(() => {
    if (userId && params.invitation) usePendingTogetherJoin.getState().clear();
  }, [userId, params.invitation]);
  // A link from the OS (cold start, or a QR scanned by the camera app).
  useEffect(() => {
    if (!userId || !gate.allowed || !params.invitation) return;
    const key = `${params.connection}:${params.transport}:${params.invitation}`;
    if (incoming.current === key) return;
    incoming.current = key;
    usePendingTogetherJoin.getState().clear();
    setCold(true);
    loadPartnerNames();
    const link = `persistencemobile://together/join?connection=${params.connection ?? "local"}&invitation=${encodeURIComponent(params.invitation)}${params.transport ? `&transport=${params.transport}` : ""}`;
    run((isCurrent) => select(link, isCurrent));
    // Explicit incoming selection once per link/account; never automatic Join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.invitation,
    params.connection,
    params.transport,
    userId,
    gate.allowed,
  ]);
  // A partner's Online session chosen on the hub.
  useEffect(() => {
    if (!userId || !gate.allowed || !params.session || !cloud) return;
    const key = `session:${params.session}`;
    if (incoming.current === key) return;
    incoming.current = key;
    loadPartnerNames();
    const sessionId = params.session;
    run(async (isCurrent) => {
      if (blocked) throw new Error("workout-already-sharing");
      const sessions = await loadPartnerSessions(cloud);
      if (!isCurrent()) return;
      const found = sessions.find((s) => s.sessionId === sessionId);
      if (!found) throw new Error("join-unavailable");
      setTarget({ kind: "online-session", ...found });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.session, userId, gate.allowed]);
  const scan = () =>
    run(async (isCurrent) => {
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (!isCurrent()) return;
      if (!result.granted) {
        setNotice(
          "Camera permission is needed. You can paste the invitation instead.",
        );
        return;
      }
      scanned.current = false;
      setScanning(true);
    });
  useEffect(() => {
    if (
      params.scan === "true" &&
      gate.allowed &&
      userId &&
      !blocked &&
      incoming.current !== "scan"
    ) {
      incoming.current = "scan";
      scan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.scan, gate.allowed, userId]);
  /** Joining starts your workout on this plan: an open workout keeps its logged sets and gains the plan. */
  const adoptAndOpen = async (isCurrent: () => boolean) => {
    // Adopt once per admission, but a failed adoption (a radio blip between
    // the effect and this call, a plan not here yet) must be retried when the
    // lobby is joined again, not leave the guest on Joining (#523).
    adopted.current = true;
    try {
      await adoptAndOpenOnce(isCurrent);
    } catch (error) {
      adopted.current = false;
      throw error;
    }
  };
  const adoptAndOpenOnce = async (isCurrent: () => boolean) => {
    if (!userId || !lobby?.workout || lobby.getSnapshot().phase !== "joined")
      throw new Error("not-admitted");
    const plan = lobby.shared?.getSnapshot().plan;
    const existing = storage.getActiveSession(userId);
    if (
      existing?.together ||
      existing?.withClient ||
      existing?.retrospectiveCompletedAt
    )
      throw new Error("workout-already-sharing");
    if (!plan) throw new Error("plan-unavailable");
    const result = existing
      ? { ok: true as const, value: existing }
      : startSessionCommand({ storage, userId, generateId: randomUUID });
    if (!result.ok) throw new Error("workout-changed");
    const logged = !!existing?.exercises.some((e) => e.sets.length > 0);
    const draft = adoptSharedPlan(
      result.value,
      plan,
      logged ? "append" : "replace-empty",
      {
        randomUUID,
        exerciseName: (id) =>
          storage.getCachedExercises().find((e) => e.id === id)?.name,
      },
    );
    if (!existing) draft.name = plan.name;
    storage.cacheActiveSession(userId, draft);
    await lobby.workout.promote(draft);
    if (!isCurrent()) return;
    // Partners see your plan from the moment you are in, not only after your
    // first set: the host publishes on start, a guest here (PER-60, PER-64).
    // A send that fails is retried with your first set, so it never blocks
    // opening the workout.
    const own = lobby.workout.getPlan(userId, draft.id);
    if (own && lobby.shared) {
      try {
        lobby.shared.setOwnPlan(own);
        void lobby.shared.publishOwnActivity().catch(() => {});
      } catch {
        /* The first logged set binds and sends the plan instead. */
      }
    }
    rereadCache();
    router.replace("/(app)/session" as never);
  };
  // A new target is a new attempt: an earlier Join press does not carry over.
  useEffect(() => {
    setAsked(false);
    adopted.current = false;
  }, [target]);
  // The host's admission is the truth. It can land after the join attempt
  // reported a failure (a late "Let in"), so a live connection always clears
  // the failure and returns to the Joining screen (TestFlight 31 Oct, PER-60).
  const live = snapshot.phase === "joined" && target?.kind === "local" && asked;
  useEffect(() => {
    if (!live) return;
    setNotice("");
    setJoining(true);
  }, [live]);
  // Admission arrives from the host, then the host's plan follows it in later
  // frames. The plan is adopted once it is here, then the workout opens; until
  // then the guest stays on Joining. Adopting at the roster frame threw
  // "plan-unavailable" and left "Could not connect" next to a live session.
  const hostPlan = !!lobby?.shared?.getSnapshot().plan;
  const admitted = live && joining && hostPlan;
  useEffect(() => {
    // `busy` re-runs this once an earlier action releases the lock, which
    // would otherwise drop the admission silently.
    if (!admitted || busy || adopted.current) return;
    run(adoptAndOpen);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [admitted, busy]);
  useEffect(() => {
    if (!userId || target?.kind === "local" || !remote.snapshot) return;
    if (remote.phase === "active") {
      const own = cloud?.readDraft(userId);
      if (own) storage.cacheActiveSession(userId, own);
      rereadCache();
      router.replace("/(app)/session" as never);
    }
  }, [
    remote.snapshot,
    remote.phase,
    userId,
    target,
    cloud,
    storage,
    rereadCache,
  ]);
  // A failed join returns to the list with the reason; the search stays as it was.
  useEffect(() => {
    if (!joining || target?.kind !== "local") return;
    if (snapshot.phase === "unavailable" || snapshot.phase === "full") {
      setJoining(false);
      setAsked(false);
      setTarget(null);
      setNotice(
        togetherErrorCopy(snapshot.error ?? snapshot.phase, snapshot.transport),
      );
    }
  }, [joining, target, snapshot.phase, snapshot.error, snapshot.transport]);
  useEffect(() => {
    if (!joining || target?.kind === "local") return;
    if (remote.phase === "idle" && remote.error) {
      setJoining(false);
      setTarget(null);
      setNotice(
        togetherCloudErrorCopy(remote.error) ??
          "Could not join. Your own workout is safe.",
      );
    }
  }, [joining, target, remote.phase, remote.error]);
  const join = () =>
    run(async (isCurrent) => {
      if (!target) return;
      setJoining(true);
      if (target.kind === "local") {
        setAsked(true);
        await lobby!.join();
        return;
      }
      if (!cloud || !userId) throw new Error("online-unavailable");
      const draft = storage.getActiveSession(userId);
      if (
        draft?.together ||
        draft?.withClient ||
        draft?.retrospectiveCompletedAt
      )
        throw new Error("workout-already-sharing");
      await cloud.join(
        target.kind === "online-session"
          ? { sessionId: target.sessionId }
          : target.kind === "online-code"
            ? { code: target.code }
            : { inviteToken: invitationPayload(target.token, "online") },
        draft ?? undefined,
      );
      if (!isCurrent()) return;
      const own = cloud.readDraft(userId);
      if (own) storage.cacheActiveSession(userId, own);
      rereadCache();
    });
  const leaveTarget = (thenSearch: boolean) =>
    run(async (isCurrent) => {
      const was = target;
      setJoining(false);
      setAsked(false);
      setTarget(null);
      setCold(false);
      // The nearby search is always running behind an Online target, so the
      // pending server request must be withdrawn first or the host could
      // still let in someone who walked away (PER-60 inspector lead).
      if (remote.phase === "pending-approval") await cloud?.cancelJoin();
      else if (was?.kind === "local" || lobby?.getSnapshot().phase !== "idle")
        await lobby?.cancel();
      else cloud?.cancel();
      if (!isCurrent()) return;
      if (thenSearch) searchRef.current();
    });
  const camera = scanning ? (
    <TogetherScannerPresenter
      onCancel={() => {
        generation.current++;
        lock.current = false;
        setBusy(false);
        setScanning(false);
      }}
      camera={
        <CameraView
          testID="together-join-camera"
          facing="back"
          style={{ flex: 1, width: "100%" }}
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={({ data }) => {
            if (scanned.current) return;
            scanned.current = true;
            setScanning(false);
            run((isCurrent) => select(data, isCurrent));
          }}
        />
      }
    />
  ) : undefined;
  const connection = target?.kind === "local" || !target ? "local" : "online";
  if (!gate.allowed || blocked) {
    const locked = gate.state === "locked";
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
              {!gate.allowed
                ? locked
                  ? "Every athlete needs a qualifying paid subscription."
                  : "Checking Together access…"
                : `You already have a live session. ${session?.together ? togetherWorkoutCopy("active") : "Your workout has been kept."}`}
            </Text>
            <Btn
              onPress={
                !gate.allowed
                  ? locked
                    ? gate.onUpgrade
                    : gate.retry
                  : () => router.replace("/(app)/session" as never)
              }
            >
              {!gate.allowed
                ? locked
                  ? "View subscriptions"
                  : "Check access"
                : "Back to my workout"}
            </Btn>
            <Btn variant="ghost" onPress={() => router.back()}>
              Back
            </Btn>
          </View>
        </Card>
      </View>
    );
  }
  if (target && joining) {
    const asking =
      snapshot.phase === "pending-approval" ||
      remote.phase === "pending-approval";
    return (
      <TogetherJoiningPresenter
        hostName={hostName(target, partners)}
        connection={connection}
        step={asking ? "ask" : "connect"}
        busy={busy}
        onCancel={() => leaveTarget(true)}
      />
    );
  }
  if (target) {
    const host = hostName(target, partners);
    const preview =
      target.kind === "online-invite" || target.kind === "online-code"
        ? target.preview
        : undefined;
    const partner =
      target.kind === "online-session" ||
      (target.kind === "local" && !!partners[target.hostUserId]) ||
      !!preview?.partner;
    const startedAt =
      target.kind === "local"
        ? target.startedAt
        : target.kind === "online-session"
          ? target.startedAt
          : preview?.startedAt;
    return (
      <TogetherJoinConsentPresenter
        hostName={host}
        workoutName={
          target.kind === "local"
            ? target.workoutName
            : target.kind === "online-session"
              ? (target.workoutName ??
                (host ? `${host}’s workout` : "Shared workout"))
              : (preview?.workoutName ?? "Shared workout")
        }
        memberCount={
          target.kind === "online-session"
            ? target.occupancy
            : target.kind === "local"
              ? target.memberCount
              : preview?.occupancy
        }
        startedAt={
          typeof startedAt === "string"
            ? Date.parse(startedAt) || undefined
            : startedAt
        }
        plan={
          target.kind === "local" || target.kind === "online-session"
            ? target.plan
            : preview?.plan
        }
        connection={connection}
        cold={cold}
        requiresApproval={!partner}
        busy={busy}
        notice={notice}
        onBack={() => leaveTarget(!cold)}
        onJoin={join}
      />
    );
  }
  const rows: TogetherJoinRow[] = [
    ...(snapshot.discovered ?? []).map((d): TogetherJoinRow => {
      const partner = partners[d.hostUserId];
      const full = d.memberCount >= 4;
      return {
        id: d.sessionId,
        title: partner?.name ?? d.workoutName,
        subtitle: partner
          ? `${d.workoutName} · ${d.memberCount} of 4`
          : full
            ? `Full · ${d.memberCount} of 4`
            : `${d.memberCount} of 4`,
        kind: full ? "full" : partner ? "partner-nearby" : "nearby",
      };
    }),
    ...online.map((s): TogetherJoinRow => {
      const name = partners[s.hostUserId]?.name ?? "Training partner";
      const full = s.occupancy >= 4;
      return {
        id: s.sessionId,
        title: name,
        subtitle: full
          ? `Full · ${s.occupancy} of 4`
          : `${s.workoutName} · ${s.occupancy} of 4`,
        kind: full ? "full" : "online",
      };
    }),
  ];
  const selectionFailed =
    snapshot.phase === "unavailable" &&
    !!snapshot.error &&
    SELECTION_ERRORS.has(snapshot.error);
  const failedCode =
    snapshot.phase === "unavailable" && snapshot.error && !selectionFailed
      ? snapshot.error
      : null;
  const state: TogetherJoinSearch = !lobby
    ? "unavailable"
    : searching
      ? "searching"
      : failedCode && searched
        ? "failed"
        : rows.length
          ? "found"
          : searched && (snapshot.phase === "browsing" || selectionFailed)
            ? "empty"
            : "searching";
  return (
    <TogetherJoinPresenter
      code={code}
      onCode={setCode}
      onContinue={() => run((isCurrent) => select(code, isCurrent))}
      onScan={scan}
      scanner={camera}
      search={state}
      elapsedSeconds={elapsed}
      rows={rows}
      failure={failedCode ? togetherSearchFailure(failedCode) : undefined}
      refreshing={refreshing}
      onRefresh={() => search(true)}
      onOpenSettings={() => void Linking.openSettings().catch(() => undefined)}
      onSelect={(id) => {
        const found = online.find((s) => s.sessionId === id);
        if (found) {
          // A row the search found starts clean: an earlier "Couldn’t find
          // that code" must not ride onto its Join this workout card.
          setNotice("");
          setCold(false);
          setTarget({ kind: "online-session", ...found });
          return;
        }
        run(async (isCurrent) => {
          await lobby!.selectDiscovered(id);
          if (!isCurrent()) return;
          const selected = lobby!.getSnapshot();
          if (selected.phase !== "selected" || !selected.selection)
            throw new Error(selected.error ?? "discovery-expired");
          const row = (snapshot.discovered ?? []).find(
            (d) => d.sessionId === id,
          );
          setCold(false);
          setTarget({
            ...localTarget(selected.selection),
            memberCount: row?.memberCount,
          });
        });
      }}
      busy={busy}
      notice={notice}
      onBack={() => router.back()}
    />
  );
}

/** Whether the nearby search has verified a host advertising this code. */
function nearbyHasCode(lobby: TogetherLobbyPort, code: string): boolean {
  return (lobby.getSnapshot().discovered ?? []).some((d) => d.code === code);
}
/**
 * Resolves true once the running nearby search verifies a host with this
 * code, false when the search ends (30 s, cancelled or failed) without one.
 */
/**
 * How long a typed code waits for the running nearby search to verify its
 * host before "not found" is said. A host in range is verified within a few
 * seconds; waiting out the whole 30 s search locked the Join screen on a
 * mistyped code (Inspector, #522).
 */
export const NEARBY_CODE_WAIT_MS = 8_000;
function nearbyFinds(lobby: TogetherLobbyPort, code: string): Promise<boolean> {
  return new Promise((resolve) => {
    let unsubscribe: (() => void) | undefined;
    let done = false;
    const finish = (found: boolean) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      unsubscribe?.();
      resolve(found);
    };
    const check = () => {
      if (done) return;
      const s = lobby.getSnapshot();
      const found = nearbyHasCode(lobby, code);
      if (!found && s.phase === "browsing" && s.searching) return;
      finish(found);
    };
    const timer = setTimeout(
      () => finish(nearbyHasCode(lobby, code)),
      NEARBY_CODE_WAIT_MS,
    );
    unsubscribe = lobby.subscribe(check);
    check();
  });
}
function hostName(
  target: Target,
  partners: Record<string, Partner>,
): string | undefined {
  if (target.kind === "online-invite" || target.kind === "online-code")
    return target.preview?.host.displayName ?? undefined;
  return partners[target.hostUserId]?.name;
}
/** A selected Nearby session as the consent card's target. */
function localTarget(
  selection: NonNullable<TogetherLobbySnapshot["selection"]>,
): Extract<Target, { kind: "local" }> {
  return {
    kind: "local",
    hostUserId: selection.hostUserId,
    workoutName: selection.workoutName,
    ...(selection.startedAt !== undefined
      ? { startedAt: selection.startedAt }
      : {}),
    ...(selection.plan ? { plan: selection.plan } : {}),
  };
}
