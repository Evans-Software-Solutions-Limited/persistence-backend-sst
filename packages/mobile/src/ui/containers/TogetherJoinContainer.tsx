import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AppState, ScrollView, TextInput } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { router, useLocalSearchParams, useFocusEffect } from "expo-router";
import { randomUUID } from "expo-crypto";
import { Text, View } from "@tamagui/core";
import { useAdapters } from "@/ui/hooks/useAdapters";
import { useActiveSession } from "@/ui/hooks/useActiveSession";
import { useTogetherGate } from "@/ui/hooks/useTogetherGate";
import { TogetherLobbyPresenter } from "@/ui/presenters/TogetherLobbyPresenter";
import { TogetherScannerPresenter } from "@/ui/presenters/TogetherScannerPresenter";
import { Btn, Field, HeaderBar } from "@/ui/components/foundation";
import {
  readTogetherInvitation,
  invitationPayload,
} from "@/application/together/invitation";
import { startSessionCommand } from "@/application/commands/session";
import { adoptSharedPlan } from "@/adapters/together/adoptSharedPlan";
import type { TogetherLobbySnapshot } from "@/domain/ports/togetherLobby.port";
import type { TogetherCloudState } from "@/domain/ports/togetherCloud.port";
import { useSafeAreaInsets } from "react-native-safe-area-context";

const noop = () => {};
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

/** Reachable before a workout exists; opening/scanning never admits automatically. */
export function TogetherJoinContainer() {
  const { storage, togetherLobby: lobby, togetherCloud: cloud } = useAdapters();
  const { userId, session, rereadCache } = useActiveSession();
  const gate = useTogetherGate();
  const params = useLocalSearchParams<{
    connection?: string;
    invitation?: string;
    transport?: string;
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
  useFocusEffect(
    useCallback(
      () => () => {
        if (lobby?.getSnapshot().phase === "browsing")
          void lobby.cancel().catch(() => {});
      },
      [lobby],
    ),
  );
  const [connection, setConnection] = useState<"local" | "online">("local");
  const [code, setCode] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [permission, requestPermission] = useCameraPermissions();
  const scope = useRef({ userId, lobby, cloud });
  scope.current = { userId, lobby, cloud };
  const mounted = useRef(true),
    lock = useRef(false),
    generation = useRef(0),
    scanned = useRef(false);
  const ownSharing = !!session?.together;
  const liveLobby = ["hosting", "joined", "reconnecting"].includes(
    snapshot.phase,
  );
  const incoming = useRef("");
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
  const run = (action: (current: () => boolean) => Promise<void>) => {
    if (
      !mounted.current ||
      scope.current.userId !== userId ||
      scope.current.lobby !== lobby ||
      scope.current.cloud !== cloud ||
      !userId ||
      !gate.allowed ||
      lock.current
    )
      return;
    const owner = scope.current,
      version = generation.current;
    const current = () =>
      mounted.current &&
      scope.current.userId === owner.userId &&
      scope.current.lobby === owner.lobby &&
      scope.current.cloud === owner.cloud &&
      version === generation.current;
    lock.current = true;
    setBusy(true);
    setNotice("");
    void Promise.resolve()
      .then(() => (current() ? action(current) : undefined))
      .catch(() => {
        if (current())
          setNotice(
            "Could not connect. Your own workout is safe. Check the invitation and try again.",
          );
      })
      .finally(() => {
        if (current()) {
          lock.current = false;
          setBusy(false);
        }
      });
  };
  const select = async (text: string) => {
    if (
      ownSharing ||
      liveLobby ||
      remote.snapshot ||
      remote.phase === "pending-approval"
    )
      throw new Error("workout-already-sharing");
    const value = text.includes("://")
      ? readTogetherInvitation(text)
      : { connection, invitation: text };
    setConnection(value.connection);
    setCode(text);
    setScanning(false);
    if (value.connection === "local") {
      if (!lobby) throw new Error("local-unavailable");
      const owner = scope.current,
        version = generation.current;
      if (lobby.getSnapshot().phase !== "idle") await lobby.cancel();
      if (
        !mounted.current ||
        scope.current.userId !== owner.userId ||
        scope.current.lobby !== owner.lobby ||
        generation.current !== version
      )
        return;
      if ("transport" in value && value.transport && lobby.selectTransport)
        lobby.selectTransport(value.transport);
      await lobby.selectInvite(value.invitation);
    }
  };
  useEffect(() => {
    if (!userId || !gate.allowed || !params.invitation) return;
    const key = `${params.connection}:${params.transport}:${params.invitation}`;
    if (incoming.current === key) return;
    incoming.current = key;
    const scheme = "persistencemobile";
    // Params came from the OS route, but the shared parser still validates shape/limits.
    const link = `${scheme}://together/join?connection=${params.connection ?? "local"}&invitation=${encodeURIComponent(params.invitation)}${params.transport ? `&transport=${params.transport}` : ""}`;
    run(() => select(link));
    // Explicit incoming selection once per link/account; never automatic Join.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    params.invitation,
    params.connection,
    params.transport,
    userId,
    gate.allowed,
  ]);
  const scan = () =>
    run(async () => {
      const version = generation.current;
      const result = permission?.granted
        ? permission
        : await requestPermission();
      if (!mounted.current || version !== generation.current) return;
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
      !ownSharing &&
      incoming.current !== "scan"
    ) {
      incoming.current = "scan";
      scan();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.scan, gate.allowed, userId]);
  const choosePlan = (keepOwn: boolean) =>
    run(async (current) => {
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
      if (!keepOwn && !plan) throw new Error("plan-unavailable");
      const result = existing
        ? { ok: true as const, value: existing }
        : startSessionCommand({ storage, userId, generateId: randomUUID });
      if (!result.ok) throw new Error("workout-changed");
      let draft = result.value;
      if (!keepOwn && plan) {
        draft = adoptSharedPlan(
          draft,
          plan,
          existing?.exercises.length ? "append" : "replace-empty",
          {
            randomUUID,
            exerciseName: (id) =>
              storage.getCachedExercises().find((e) => e.id === id)?.name,
          },
        );
        if (!existing) draft.name = plan.name;
        storage.cacheActiveSession(userId, draft);
      }
      await lobby.workout.promote(draft);
      if (!current()) return;
      rereadCache();
      if (mounted.current && scope.current.userId === userId)
        router.replace("/(app)/session" as never);
    });
  const joinOnline = () =>
    run(async (current) => {
      if (!cloud || !userId) throw new Error("online-unavailable");
      const draft = storage.getActiveSession(userId);
      if (
        draft?.together ||
        draft?.withClient ||
        draft?.retrospectiveCompletedAt
      )
        throw new Error("workout-already-sharing");
      await cloud.join(
        { inviteToken: invitationPayload(code, "online") },
        draft ?? undefined,
      );
      if (!current()) return;
      const own = cloud.readDraft(userId);
      if (own) storage.cacheActiveSession(userId, own);
      rereadCache();
    });
  useEffect(() => {
    if (!userId || connection !== "online" || !remote.snapshot) return;
    const own = cloud?.readDraft(userId);
    if (own && remote.phase === "active") {
      storage.cacheActiveSession(userId, own);
      rereadCache();
    }
  }, [
    remote.snapshot,
    remote.phase,
    userId,
    connection,
    cloud,
    storage,
    rereadCache,
  ]);
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
            run(() => select(data));
          }}
        />
      }
    />
  ) : undefined;
  return (
    <View flex={1} backgroundColor="$bg" paddingTop={insets.top}>
      <HeaderBar
        title="Join a workout"
        leading={
          <Btn variant="ghost" onPress={() => router.back()}>
            Back
          </Btn>
        }
      />
      <ScrollView
        contentContainerStyle={{
          padding: 20,
          paddingBottom: insets.bottom + 30,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <View gap={16}>
          {gate.allowed &&
            !ownSharing &&
            !liveLobby &&
            !remote.snapshot &&
            remote.phase !== "pending-approval" && (
              <View flexDirection="row" gap={10}>
                <Btn
                  variant={connection === "local" ? "soft" : "outline"}
                  onPress={() => {
                    setConnection("local");
                    setNotice("");
                  }}
                >
                  Local
                </Btn>
                {cloud && (
                  <Btn
                    variant={connection === "online" ? "soft" : "outline"}
                    onPress={() => {
                      setConnection("online");
                      setNotice("");
                    }}
                  >
                    Online
                  </Btn>
                )}
              </View>
            )}
          {!gate.allowed ? (
            <>
              <Text color="$text2">
                {gate.state === "locked"
                  ? "Every athlete needs a qualifying paid subscription."
                  : "Checking Together access…"}
              </Text>
              <Btn
                onPress={gate.state === "locked" ? gate.onUpgrade : gate.retry}
              >
                {gate.state === "locked"
                  ? "View subscriptions"
                  : "Check access"}
              </Btn>
            </>
          ) : ownSharing || (liveLobby && snapshot.phase !== "joined") ? (
            <>
              <Text color="$text2">
                You already have a live session. Your workout has been kept.
              </Text>
              <Btn onPress={() => router.replace("/(app)/session" as never)}>
                Back to my workout
              </Btn>
            </>
          ) : connection === "online" ? (
            <>
              {remote.phase !== "active" &&
                remote.phase !== "pending-approval" && (
                  <>
                    <Field label="Invitation link or code">
                      <TextInput
                        accessibilityLabel="Invitation link or code"
                        value={code}
                        onChangeText={setCode}
                        autoCapitalize="none"
                        autoCorrect={false}
                        style={{
                          color: "#f4f4f4",
                          borderWidth: 1,
                          borderColor: "#555",
                          padding: 12,
                          borderRadius: 12,
                        }}
                      />
                    </Field>
                    <Btn variant="outline" onPress={scan}>
                      Scan invitation
                    </Btn>
                    {camera}
                  </>
                )}
              <Text color="$text2">
                {remote.phase === "pending-approval"
                  ? "Waiting for the host to approve your request."
                  : remote.phase === "active"
                    ? "You have joined. Your workout is ready."
                    : "Online invitation ready. Choose Join to request admission."}
              </Text>
              {!!notice && (
                <Text color="$warning" accessibilityRole="alert">
                  {notice}
                </Text>
              )}
              {remote.phase === "active" ? (
                <Btn onPress={() => router.replace("/(app)/session" as never)}>
                  Open my workout
                </Btn>
              ) : (
                <Btn
                  disabled={
                    busy || !code || remote.phase === "pending-approval"
                  }
                  onPress={joinOnline}
                >
                  Join
                </Btn>
              )}
            </>
          ) : snapshot.phase === "joined" ? (
            <>
              <Text color="$text" fontFamily="$display" fontSize={22}>
                {snapshot.selection?.workoutName ?? "You have joined"}
              </Text>
              <Text color="$text2">
                Choose how to train. Your existing sets stay yours.
              </Text>
              <Btn
                disabled={busy || !lobby?.shared?.getSnapshot().plan}
                onPress={() => choosePlan(false)}
              >
                {session?.exercises.length
                  ? "Add shared plan to my workout"
                  : "Use shared workout"}
              </Btn>
              {session && (
                <Btn
                  variant="outline"
                  disabled={busy}
                  onPress={() => choosePlan(true)}
                >
                  Keep my own workout
                </Btn>
              )}
              <Btn
                variant="ghost"
                disabled={busy}
                onPress={() =>
                  run(async (current) => {
                    await lobby?.cancel();
                    if (current()) router.back();
                  })
                }
              >
                Leave lobby
              </Btn>
              {!!notice && <Text color="$warning">{notice}</Text>}
            </>
          ) : (
            <TogetherLobbyPresenter
              snapshot={snapshot}
              accountId={userId ?? undefined}
              screen="join"
              code={code}
              notice={notice}
              workoutName=""
              audience="open"
              onAudienceChange={noop}
              onBrowse={() => run(() => lobby!.browse())}
              onSelectDiscovered={(id) =>
                run(() => lobby!.selectDiscovered(id))
              }
              onUseInvitation={() => run(() => lobby!.cancel())}
              onCodeChange={setCode}
              onHost={noop}
              onSelect={() => run(() => select(code))}
              onJoin={() => run(() => lobby!.join())}
              onScan={scan}
              onCopy={noop}
              onReconnect={() => run(() => lobby!.reconnect())}
              onCancel={() =>
                run(async (current) => {
                  await lobby?.cancel();
                  if (current()) router.back();
                })
              }
              onApprove={noop}
              onDecline={noop}
              scanner={camera}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
